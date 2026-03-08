import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Monitor,
  Globe,
  AppWindow,
  Gamepad2,
  Trash2,
  Search,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Folder
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatBytes, formatNumber } from '@/lib/utils'
import { useScanStore } from '@/stores/scan-store'
import { useStatsStore } from '@/stores/stats-store'
import { useHistoryStore } from '@/stores/history-store'
import { ScanStatus, CleanerType } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

interface CategoryDef {
  type: CleanerType
  label: string
  icon: LucideIcon
  description: string
}

const categories: CategoryDef[] = [
  { type: CleanerType.System, label: 'System', icon: Monitor, description: 'Temp files, logs, caches, dumps, updates' },
  { type: CleanerType.Browser, label: 'Browsers', icon: Globe, description: 'Cache, cookies, history' },
  { type: CleanerType.App, label: 'Applications', icon: AppWindow, description: 'App caches and dev tools' },
  { type: CleanerType.Gaming, label: 'Gaming', icon: Gamepad2, description: 'Launcher caches, redistributables' },
  { type: CleanerType.RecycleBin, label: 'Recycle Bin', icon: Trash2, description: 'Deleted files' }
]

export function CleanerPage() {
  const store = useScanStore()
  const recomputeStats = useStatsStore((s) => s.recompute)
  const historyStore = useHistoryStore()
  const [activeCategory, setActiveCategory] = useState<CleanerType>(CleanerType.System)
  const [showConfirm, setShowConfirm] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const cleanStartRef = useRef<number>(0)

  useEffect(() => {
    if (!window.dustforge?.onScanProgress) return
    return window.dustforge.onScanProgress((data) => store.setProgress(data))
  }, [])

  const handleScan = useCallback(async () => {
    store.setStatus(ScanStatus.Scanning)
    store.setResults([])
    setExpandedGroups(new Set())
    try {
      const scanFns: Record<CleanerType, () => Promise<ScanResult[]>> = {
        [CleanerType.System]: () => window.dustforge.systemScan(),
        [CleanerType.Browser]: () => window.dustforge.browserScan(),
        [CleanerType.App]: () => window.dustforge.appScan(),
        [CleanerType.Gaming]: () => window.dustforge.gamingScan(),
        [CleanerType.RecycleBin]: () => window.dustforge.recycleBinScan()
      }
      for (const cat of categories) {
        try {
          const results = await scanFns[cat.type]()
          store.addResults(results)
        } catch { /* skip */ }
      }
      store.setStatus(ScanStatus.Complete)
    } catch {
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
  }, [])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    store.setStatus(ScanStatus.Cleaning)
    cleanStartRef.current = Date.now()
    try {
      const selectedIds = store.getSelectedIds()
      const cleanFns: Record<CleanerType, (ids: string[]) => Promise<any>> = {
        [CleanerType.System]: (ids) => window.dustforge.systemClean(ids),
        [CleanerType.Browser]: (ids) => window.dustforge.browserClean(ids),
        [CleanerType.App]: (ids) => window.dustforge.appClean(ids),
        [CleanerType.Gaming]: (ids) => window.dustforge.gamingClean(ids),
        [CleanerType.RecycleBin]: () => window.dustforge.recycleBinClean()
      }
      let totalCleaned = 0, totalFiles = 0, totalSkipped = 0
      const allErrors: { path: string; reason: string }[] = []
      const categoryBreakdown: Record<string, { found: number; cleaned: number; space: number }> = {}

      for (const cat of categories) {
        const catResults = store.results.filter((r) => r.category === cat.type)
        const catItemsAll = catResults.flatMap((r) => r.items)
        const catItemIds = catItemsAll
          .filter((item) => selectedIds.includes(item.id))
          .map((item) => item.id)
        if (catItemIds.length > 0) {
          try {
            const result = await cleanFns[cat.type](catItemIds)
            if (result) {
              totalCleaned += result.totalCleaned || 0
              totalFiles += result.filesDeleted || 0
              totalSkipped += result.filesSkipped || 0
              if (result.errors?.length) allErrors.push(...result.errors)
              categoryBreakdown[cat.label] = {
                found: catItemsAll.length,
                cleaned: result.filesDeleted || 0,
                space: result.totalCleaned || 0
              }
            }
          } catch { /* continue */ }
        } else if (catItemsAll.length > 0) {
          categoryBreakdown[cat.label] = { found: catItemsAll.length, cleaned: 0, space: 0 }
        }
      }

      const totalFound = store.results.reduce((s, r) => s + r.itemCount, 0)
      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalFound,
        totalItemsCleaned: totalFiles,
        totalItemsSkipped: totalSkipped,
        totalSpaceSaved: totalCleaned,
        categories: Object.entries(categoryBreakdown).map(([name, d]) => ({
          name, itemsFound: d.found, itemsCleaned: d.cleaned, spaceSaved: d.space
        })),
        errorCount: allErrors.length
      })
      recomputeStats()

      store.setCleanResult({ totalCleaned, filesDeleted: totalFiles, filesSkipped: totalSkipped, errors: allErrors })
      store.setStatus(ScanStatus.Complete)
    } catch {
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
  }, [store.results])

  const categoryResults = (type: CleanerType) => store.results.filter((r) => r.category === type)
  const categoryItemCount = (type: CleanerType) => categoryResults(type).reduce((sum, r) => sum + r.itemCount, 0)

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSubcategorySelection = (result: ScanResult) => {
    store.toggleSubcategory(result)
  }

  const isScanning = store.status === ScanStatus.Scanning
  const isCleaning = store.status === ScanStatus.Cleaning
  const hasResults = store.results.length > 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="System Cleaner"
        description="Scan and clean junk files from your system"
        action={
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleScan}
              disabled={isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              Scan
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!hasResults || isScanning || isCleaning || store.getSelectedIds().length === 0}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#1a0a00',
                boxShadow: hasResults ? '0 4px 20px rgba(245,158,11,0.2)' : 'none'
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              Clean
            </button>
          </div>
        }
      />

      <div className="flex gap-5">
        {/* Category sidebar */}
        <div className="w-56 shrink-0 space-y-1.5">
          {categories.map((cat) => {
            const count = categoryItemCount(cat.type)
            const isActive = activeCategory === cat.type
            return (
              <button
                key={cat.type}
                onClick={() => setActiveCategory(cat.type)}
                className="relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all"
                style={{
                  background: isActive ? 'rgba(245,158,11,0.06)' : 'transparent',
                  color: isActive ? '#fbbf24' : '#71717a'
                }}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full" style={{ background: '#f59e0b' }} />
                )}
                <cat.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium">{cat.label}</span>
                  <p className="text-[11px]" style={{ color: '#4e4e56' }}>{cat.description}</p>
                </div>
                {count > 0 && (
                  <span
                    className="rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#8e8e96' }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}

          {hasResults && (
            <div className="mt-5 rounded-2xl p-4" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-[11px] font-medium" style={{ color: '#52525e' }}>Total recoverable</p>
              <p className="text-[20px] font-bold tracking-tight text-amber-400">{formatBytes(store.getTotalSize())}</p>
              <p className="text-[11px]" style={{ color: '#52525e' }}>
                {formatNumber(store.results.reduce((s, r) => s + r.itemCount, 0))} items
              </p>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <p className="text-[11px] font-medium" style={{ color: '#52525e' }}>Selected</p>
                <p className="text-[15px] font-semibold text-zinc-200">{formatBytes(store.getSelectedSize())}</p>
              </div>
            </div>
          )}
        </div>

        {/* Item panel */}
        <div className="flex-1 min-w-0">
          {(isScanning || isCleaning) && store.progress && (
            <ScanProgress
              status={isScanning ? 'scanning' : 'cleaning'}
              progress={store.progress.progress}
              currentPath={store.progress.currentPath}
              itemsFound={store.progress.itemsFound}
              sizeFound={store.progress.sizeFound}
              className="mb-5"
            />
          )}

          {store.cleanResult && store.status === ScanStatus.Complete && (
            <div
              className="mb-5 rounded-2xl p-4"
              style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">Cleaning complete!</p>
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    Cleaned {formatBytes(store.cleanResult.totalCleaned)} · {formatNumber(store.cleanResult.filesDeleted)} items deleted
                    {store.cleanResult.filesSkipped > 0 && (
                      <span style={{ color: '#a1a1aa' }}> · {formatNumber(store.cleanResult.filesSkipped)} skipped (in use or protected)</span>
                    )}
                  </p>
                </div>
              </div>
              {store.cleanResult.errors.length > 0 && (
                <details className="mt-2 ml-8">
                  <summary className="text-[11px] cursor-pointer" style={{ color: '#6e6e76' }}>
                    {store.cleanResult.errors.length} items couldn't be deleted
                  </summary>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                    {store.cleanResult.errors.slice(0, 20).map((err, i) => (
                      <p key={i} className="text-[11px] font-mono truncate" style={{ color: '#52525e' }}>
                        {err.path.split('\\').slice(-3).join('\\')} — {err.reason}
                      </p>
                    ))}
                    {store.cleanResult.errors.length > 20 && (
                      <p className="text-[11px]" style={{ color: '#52525e' }}>
                        ... and {store.cleanResult.errors.length - 20} more
                      </p>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}

          {!hasResults && !isScanning && (
            <EmptyState
              icon={Search}
              title="No scan results"
              description='Click "Scan" to analyze your system for files that can be safely removed.'
            />
          )}

          {hasResults && (
            <div key={activeCategory} className="space-y-2">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
                  {categories.find((c) => c.type === activeCategory)?.label} Items
                </span>
                <button
                  onClick={() => store.toggleCategory(activeCategory)}
                  className="text-[12px] font-medium text-amber-500 hover:text-amber-400"
                >
                  Toggle All
                </button>
              </div>

              {categoryResults(activeCategory).length === 0 && (
                <div className="py-12 text-center text-[13px]" style={{ color: '#4e4e56' }}>
                  No items found in this category
                </div>
              )}

              {(() => {
                const results = categoryResults(activeCategory)
                // Group results by group label (ungrouped first, then grouped sections)
                const ungrouped = results.filter((r) => !r.group)
                const grouped = new Map<string, ScanResult[]>()
                for (const r of results) {
                  if (!r.group) continue
                  if (!grouped.has(r.group)) grouped.set(r.group, [])
                  grouped.get(r.group)!.push(r)
                }

                const sections: { label?: string; items: ScanResult[] }[] = []
                if (ungrouped.length > 0) sections.push({ items: ungrouped })
                for (const [label, items] of grouped) sections.push({ label, items })

                return sections.map((section) => (
                  <div key={section.label || '_ungrouped'}>
                    {section.label && (
                      <div className="mt-4 mb-2 flex items-center gap-2 px-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#6e6e76' }}>
                          {section.label}
                        </span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                        <span className="text-[11px] font-mono" style={{ color: '#4e4e56' }}>
                          {formatBytes(section.items.reduce((s, r) => s + r.totalSize, 0))}
                        </span>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {section.items.map((result) => {
                        const groupKey = `${result.category}:${result.subcategory}`
                        const isExpanded = expandedGroups.has(groupKey)
                        const selectedInGroup = result.items.filter((item) => store.selectedItems.has(item.id)).length
                        const allSelected = selectedInGroup === result.items.length
                        const someSelected = selectedInGroup > 0 && !allSelected

                        return (
                          <div key={result.subcategory} className="rounded-xl overflow-hidden"
                            style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
                            {/* Group header */}
                            <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer"
                              onClick={() => toggleGroup(groupKey)}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                              {/* Checkbox */}
                              <div onClick={(e) => { e.stopPropagation(); toggleSubcategorySelection(result) }}
                                className="flex items-center">
                                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] cursor-pointer"
                                  style={{
                                    background: allSelected || someSelected ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                                    border: allSelected || someSelected ? 'none' : '1.5px solid rgba(255,255,255,0.12)'
                                  }}>
                                  {allSelected && (
                                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                                      <path d="M2.5 6l2.5 2.5 4.5-5" stroke="#1a0a00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  )}
                                  {someSelected && (
                                    <div className="h-[2px] w-2 rounded-full" style={{ background: '#1a0a00' }} />
                                  )}
                                </div>
                              </div>

                              {/* Expand arrow */}
                              <ChevronRight
                                className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isExpanded && 'rotate-90')}
                                style={{ color: '#4e4e56' }}
                                strokeWidth={2}
                              />

                              {/* Folder icon */}
                              <Folder className="h-4 w-4 shrink-0" style={{ color: allSelected ? '#f59e0b' : '#4e4e56' }} strokeWidth={1.8} />

                              {/* Label */}
                              <div className="flex-1 min-w-0">
                                <span className="text-[13px] font-medium text-zinc-300">{result.subcategory}</span>
                              </div>

                              {/* Stats */}
                              <span className="rounded-md px-2 py-0.5 font-mono text-[11px] shrink-0"
                                style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}>
                                {formatNumber(result.itemCount)} {result.itemCount === 1 ? 'item' : 'items'}
                              </span>
                              <span className="font-mono text-[12px] font-medium shrink-0" style={{ color: '#8e8e96' }}>
                                {formatBytes(result.totalSize)}
                              </span>
                            </div>

                            {/* Expanded item list */}
                            {isExpanded && (
                              <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                {result.items.slice(0, 50).map((item) => {
                                  const checked = store.selectedItems.has(item.id)
                                  const pathLabel = item.path.split('\\').slice(-2).join('\\') || item.path
                                  return (
                                    <label key={item.id}
                                      className="flex items-center gap-3 px-4 py-2 pl-14 cursor-pointer transition-colors"
                                      style={{ background: checked ? 'rgba(245,158,11,0.03)' : 'transparent' }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.015)' }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.03)' : 'transparent' }}>
                                      <input type="checkbox" checked={checked} onChange={() => store.toggleItem(item.id)}
                                        className="sr-only peer" />
                                      <div className="flex h-[16px] w-[16px] items-center justify-center rounded-[4px] shrink-0"
                                        style={{
                                          background: checked ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                                          border: checked ? 'none' : '1.5px solid rgba(255,255,255,0.1)'
                                        }}>
                                        {checked && (
                                          <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
                                            <path d="M2.5 6l2.5 2.5 4.5-5" stroke="#1a0a00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                          </svg>
                                        )}
                                      </div>
                                      <span className="flex-1 min-w-0 truncate text-[12px] font-mono" style={{ color: '#6e6e76' }}>
                                        {pathLabel}
                                      </span>
                                      <span className="font-mono text-[11px] shrink-0" style={{ color: '#4e4e56' }}>
                                        {formatBytes(item.size)}
                                      </span>
                                    </label>
                                  )
                                })}
                                {result.items.length > 50 && (
                                  <div className="px-4 py-2.5 pl-14 text-[11px]" style={{ color: '#4e4e56' }}>
                                    ... and {formatNumber(result.items.length - 50)} more items
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title="Clean Selected Files"
        description={`This will permanently delete ${formatNumber(store.getSelectedIds().length)} items (${formatBytes(store.getSelectedSize())}). This action cannot be undone.`}
        confirmLabel="Clean Now"
        variant="warning"
      />
    </div>
  )
}
