import { BrowserWindow, ipcMain } from 'electron'
import { readdir, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import { extname } from 'path'
import type { DiskNode, DriveInfo, FileTypeInfo } from '../../shared/types'
import type { WindowGetter } from './index'

const execFileAsync = promisify(execFile)

const MAX_DEPTH = 3
const FILE_TYPE_MAX_DEPTH = 4

// ── Internal helpers ──

async function analyzeDirectory(
  dirPath: string,
  depth: number,
  mainWindow: BrowserWindow | null
): Promise<DiskNode> {
  const node: DiskNode = {
    name: dirPath.split('\\').pop() || dirPath,
    path: dirPath,
    size: 0,
    children: []
  }

  if (depth >= MAX_DEPTH) {
    node.size = await quickSize(dirPath)
    return node
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const child = await analyzeDirectory(fullPath, depth + 1, mainWindow)
          node.children!.push(child)
          node.size += child.size
        } else {
          const s = await stat(fullPath)
          node.size += s.size
        }
      } catch {
        // Skip inaccessible
      }
    }

    if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk',
        currentPath: dirPath,
        progress: 50,
        itemsFound: node.children!.length,
        sizeFound: node.size
      })
    }
  } catch {
    // Inaccessible directory
  }

  node.children?.sort((a, b) => b.size - a.size)
  return node
}

async function collectFileTypes(
  dirPath: string,
  depth: number,
  extMap: Map<string, { size: number; count: number }>,
  mainWindow: BrowserWindow | null
): Promise<void> {
  if (depth >= FILE_TYPE_MAX_DEPTH) return
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          await collectFileTypes(fullPath, depth + 1, extMap, mainWindow)
        } else {
          const s = await stat(fullPath)
          const ext = (extname(entry.name) || '(no extension)').toLowerCase()
          const existing = extMap.get(ext)
          if (existing) {
            existing.size += s.size
            existing.count += 1
          } else {
            extMap.set(ext, { size: s.size, count: 1 })
          }
        }
      } catch {
        // Skip inaccessible
      }
    }
    if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk-file-types',
        currentPath: dirPath,
        progress: 50,
        itemsFound: extMap.size,
        sizeFound: 0
      })
    }
  } catch {
    // Inaccessible directory
  }
}

async function quickSize(dirPath: string): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        const s = await stat(join(dirPath, entry.name))
        size += s.isDirectory() ? 0 : s.size
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return size
}

// ── Exported core logic ──

export async function getDrives(): Promise<DriveInfo[]> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `$fixed = (Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }).DeviceID -replace ':',''; Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and $fixed -contains $_.Name } | ForEach-Object { "$($_.Name)|$($_.Description)|$($_.Used)|$($_.Free)" }`
    ], { timeout: 10000 })

    const drives: DriveInfo[] = []
    for (const line of stdout.trim().split('\n')) {
      const [letter, label, used, free] = line.trim().split('|')
      if (letter && used && free) {
        const usedSpace = parseInt(used) || 0
        const freeSpace = parseInt(free) || 0
        drives.push({
          letter: letter.trim(),
          label: label?.trim() || letter.trim(),
          totalSize: usedSpace + freeSpace,
          freeSpace,
          usedSpace
        })
      }
    }
    return drives
  } catch {
    return []
  }
}

export async function analyzeDisk(driveLetter: string): Promise<DiskNode> {
  if (typeof driveLetter !== 'string' || !/^[A-Za-z]$/.test(driveLetter)) {
    return { name: '', path: '', size: 0, children: [] }
  }
  const rootPath = `${driveLetter.toUpperCase()}:\\`
  return analyzeDirectory(rootPath, 0, null)
}

export async function getFileTypes(driveLetter: string): Promise<FileTypeInfo[]> {
  if (typeof driveLetter !== 'string' || !/^[A-Za-z]$/.test(driveLetter)) {
    return []
  }
  const rootPath = `${driveLetter.toUpperCase()}:\\`
  const extMap = new Map<string, { size: number; count: number }>()
  await collectFileTypes(rootPath, 0, extMap, null)
  const results: FileTypeInfo[] = []
  for (const [ext, info] of extMap) {
    results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
  }
  results.sort((a, b) => b.totalSize - a.totalSize)
  return results
}

// ── IPC registration ──

export function registerDiskAnalyzerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DISK_DRIVES, () => getDrives())

  ipcMain.handle(IPC.DISK_FILE_TYPES, async (_event, driveLetter: string): Promise<FileTypeInfo[]> => {
    if (typeof driveLetter !== 'string' || !/^[A-Za-z]$/.test(driveLetter)) {
      return []
    }
    const rootPath = `${driveLetter.toUpperCase()}:\\`
    const extMap = new Map<string, { size: number; count: number }>()
    await collectFileTypes(rootPath, 0, extMap, getWindow())
    const results: FileTypeInfo[] = []
    for (const [ext, info] of extMap) {
      results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
    }
    results.sort((a, b) => b.totalSize - a.totalSize)
    return results
  })

  ipcMain.handle(IPC.DISK_ANALYZE, async (_event, driveLetter: string): Promise<DiskNode> => {
    if (typeof driveLetter !== 'string' || !/^[A-Za-z]$/.test(driveLetter)) {
      return { name: '', path: '', size: 0, children: [] }
    }
    const rootPath = `${driveLetter.toUpperCase()}:\\`
    return analyzeDirectory(rootPath, 0, getWindow())
  })
}
