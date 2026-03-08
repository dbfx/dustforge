import type { ScanItem } from '../../shared/types'

/**
 * In-memory cache of scan results so clean handlers can look up
 * item paths by ID. Each scan replaces the previous cache for that category.
 */
const itemCache = new Map<string, ScanItem>()
const MAX_CACHE_SIZE = 10000

export function cacheItems(items: ScanItem[]): void {
  // Evict oldest entries if cache is getting too large
  if (itemCache.size + items.length > MAX_CACHE_SIZE) {
    itemCache.clear()
  }
  for (const item of items) {
    itemCache.set(item.id, item)
  }
}

export function getCachedItem(id: string): ScanItem | undefined {
  return itemCache.get(id)
}

export function getCachedItems(ids: string[]): ScanItem[] {
  const items: ScanItem[] = []
  for (const id of ids) {
    const item = itemCache.get(id)
    if (item) items.push(item)
  }
  return items
}

export function clearCache(): void {
  itemCache.clear()
}
