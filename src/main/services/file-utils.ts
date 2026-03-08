import { rm, stat, readdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ScanItem, ScanResult, CleanResult } from '../../shared/types'
import { getCachedItems } from './scan-cache'
import { getSettings } from './settings-store'

export interface DeleteResult {
  path: string
  success: boolean
  reason?: string
}

/**
 * Check if a path matches any of the configured exclusions.
 * Supports exact path prefixes and *.ext glob patterns.
 */
function isExcluded(filePath: string, exclusions: string[]): boolean {
  if (exclusions.length === 0) return false
  const normalized = filePath.toLowerCase().replace(/\//g, '\\')
  for (const exc of exclusions) {
    const pattern = exc.toLowerCase().replace(/\//g, '\\')
    if (pattern.startsWith('*.')) {
      // Extension glob: *.log, *.tmp etc.
      if (normalized.endsWith(pattern.substring(1))) return true
    } else {
      // Path prefix match
      if (normalized.startsWith(pattern) || normalized === pattern) return true
    }
  }
  return false
}

export async function safeDelete(filePath: string): Promise<DeleteResult> {
  try {
    await rm(filePath, { force: true, recursive: true })
    return { path: filePath, success: true }
  } catch (err: any) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      return { path: filePath, success: false, reason: 'in-use' }
    }
    if (err.code === 'EACCES') {
      return { path: filePath, success: false, reason: 'permission-denied' }
    }
    if (err.code === 'ENOENT') {
      return { path: filePath, success: true }
    }
    return { path: filePath, success: false, reason: err.message }
  }
}

/**
 * Look up cached scan items by ID, delete each one, and return a CleanResult.
 */
export async function cleanItems(itemIds: unknown): Promise<CleanResult> {
  // Validate input is a string array
  const validIds = Array.isArray(itemIds)
    ? itemIds.filter((v): v is string => typeof v === 'string')
    : []
  const items = getCachedItems(validIds)
  let totalCleaned = 0
  let filesDeleted = 0
  let filesSkipped = 0
  const errors: CleanResult['errors'] = []

  for (const item of items) {
    const result = await safeDelete(item.path)
    if (result.success) {
      totalCleaned += item.size
      filesDeleted++
    } else {
      filesSkipped++
      if (result.reason) {
        errors.push({ path: item.path, reason: result.reason })
      }
    }
  }

  return { totalCleaned, filesDeleted, filesSkipped, errors }
}

export async function scanDirectory(
  dirPath: string,
  category: string,
  subcategory: string,
  skipRecentMinutes = 60
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  const cutoff = Date.now() - skipRecentMinutes * 60 * 1000
  const MAX_ITEMS = 200
  const exclusions = getSettings().exclusions

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (items.length >= MAX_ITEMS) break
      const fullPath = join(dirPath, entry.name)

      // Check exclusions
      if (isExcluded(fullPath, exclusions)) continue

      try {
        const stats = await stat(fullPath)

        if (stats.mtimeMs > cutoff) continue

        const size = stats.isDirectory() ? await getDirectorySize(fullPath, 2) : stats.size

        const item: ScanItem = {
          id: randomUUID(),
          path: fullPath,
          size,
          category,
          subcategory,
          lastModified: stats.mtimeMs,
          selected: true
        }

        items.push(item)
        totalSize += item.size
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Directory doesn't exist or is inaccessible
  }

  return {
    category,
    subcategory,
    items,
    totalSize,
    itemCount: items.length
  }
}

/**
 * Scan multiple directories and merge their items into a single ScanResult.
 * Each item's subcategory is set to the provided label so they group together.
 */
export async function scanMultipleDirectories(
  dirPaths: string[],
  category: string,
  subcategory: string,
  skipRecentMinutes = 60
): Promise<ScanResult> {
  const allItems: ScanItem[] = []
  let totalSize = 0

  for (const dirPath of dirPaths) {
    const result = await scanDirectory(dirPath, category, subcategory, skipRecentMinutes)
    allItems.push(...result.items)
    totalSize += result.totalSize
  }

  return {
    category,
    subcategory,
    items: allItems,
    totalSize,
    itemCount: allItems.length,
  }
}

export async function scanFile(
  filePath: string,
  category: string,
  subcategory: string
): Promise<ScanResult> {
  const exclusions = getSettings().exclusions
  if (isExcluded(filePath, exclusions)) {
    return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
  }

  try {
    const stats = await stat(filePath)
    if (!stats.isFile()) {
      return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
    }
    const item: ScanItem = {
      id: randomUUID(),
      path: filePath,
      size: stats.size,
      category,
      subcategory,
      lastModified: stats.mtimeMs,
      selected: true
    }
    return { category, subcategory, items: [item], totalSize: stats.size, itemCount: 1 }
  } catch {
    return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
  }
}

/**
 * Treat each directory path as a single deletable item (not individual files inside).
 * Returns one ScanItem per existing directory with its total size.
 */
export async function scanDirectoriesAsItems(
  dirPaths: string[],
  category: string,
  subcategory: string,
  group?: string
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  const exclusions = getSettings().exclusions

  for (const dirPath of dirPaths) {
    if (isExcluded(dirPath, exclusions)) continue

    try {
      const stats = await stat(dirPath)
      if (!stats.isDirectory()) continue
      const size = await getDirectorySize(dirPath, 3)
      if (size < 1024) continue

      items.push({
        id: randomUUID(),
        path: dirPath,
        size,
        category,
        subcategory,
        lastModified: stats.mtimeMs,
        selected: true,
      })
      totalSize += size
    } catch {
      // Path doesn't exist or inaccessible
    }
  }

  return { category, subcategory, group, items, totalSize, itemCount: items.length }
}

export async function getDirectorySize(dirPath: string, maxDepth = 3): Promise<number> {
  if (maxDepth <= 0) return 0
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        const stats = await stat(fullPath)
        if (stats.isDirectory()) {
          size += await getDirectorySize(fullPath, maxDepth - 1)
        } else {
          size += stats.size
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return size
}
