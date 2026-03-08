import { useState, useCallback, useRef } from 'react'
import {
  Search,
  Sparkles,
  CheckCircle2,
  Wifi,
  Globe,
  Network,
  History
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import type { NetworkItem, NetworkCleanResult } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'

type NetworkCategory = NetworkItem['type']

interface CategoryDef {
  type: NetworkCategory
  label: string
  icon: LucideIcon
  description: string
}

const categories: CategoryDef[] = [
  { type: 'dns-cache', label: 'DNS Cache', icon: Globe, description: 'Cached domain name lookups' },
  { type: 'wifi-profile', label: 'Wi-Fi Profiles', icon: Wifi, description: 'Saved wireless networks' },
  { type: 'arp-cache', label: 'ARP Cache', icon: Network, description: 'IP-to-MAC address mappings' },
  { type: 'network-history', label: 'Network History', icon: History, description: 'Past network connections' }
]

export function NetworkCleanupPage() {
  const [items, setItems] = useState<NetworkItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'idle' | 'scanning' | 'cleaning' | 'complete'>('idle')
  const [cleanResult, setCleanResult] = useState<NetworkCleanResult | null>(null)
  const [activeCategory, setActiveCategory] = useState<NetworkCategory>('dns-cache')
  const [showConfirm, setShowConfirm] = useState(false)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)
  const scanStartRef = useRef<number>(0)

  const handleScan = useCallback(async () => {
    setStatus('scanning')
    setItems([])
    setSelectedIds(new Set())
    setCleanResult(null)
    scanStartRef.current = Date.now()
    try {
      const result = await window.dustforge.networkScan()
      setItems(result)
      const preSelected = new Set(result.filter((i) => i.selected).map((i) => i.id))
      setSelectedIds(preSelected)
      setStatus('complete')
    } catch {
      setStatus('idle')
    }
  }, [])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    setStatus('cleaning')
    try {
      const result = await window.dustforge.networkClean([...selectedIds])
      setCleanResult(result)
      // Remove cleaned items from list
      setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)))
      setSelectedIds(new Set())

      // Log to scan history
      const byType: Record<string, { found: number; cleaned: number }> = {}
      for (const item of items) {
        if (!byType[item.type]) byType[item.type] = { found: 0, cleaned: 0 }
        byType[item.type].found++
        if (selectedIds.has(item.id)) byType[item.type].cleaned++
      }
      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'network',
        timestamp: new Date().toISOString(),
        duration: Date.now() - scanStartRef.current,
        totalItemsFound: items.length,
        totalItemsCleaned: result.cleaned,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byType).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.cleaned,
          spaceSaved: 0
        })),
        errorCount: result.failed
      })
      recomputeStats()

      setStatus('complete')
    } catch {
      setStatus('idle')
    }
  }, [selectedIds, items, historyStore, recomputeStats])

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCategory = (type: NetworkCategory) => {
    const catItems = items.filter((i) => i.type === type)
    const allSelected = catItems.every((i) => selectedIds.has(i.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const item of catItems) {
        if (allSelected) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }

  const isScanning = status === 'scanning'
  const isCleaning = status === 'cleaning'
  const hasItems = items.length > 0
  const categoryItems = items.filter((i) => i.type === activeCategory)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Network Cleanup"
        description="Clear DNS cache, saved Wi-Fi profiles, and network history"
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
              disabled={!hasItems || isScanning || isCleaning || selectedIds.size === 0}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#1a0a00',
                boxShadow: hasItems ? '0 4px 20px rgba(245,158,11,0.2)' : 'none'
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
            const count = items.filter((i) => i.type === cat.type).length
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

          {hasItems && (
            <div className="mt-5 rounded-2xl p-4" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-[11px] font-medium" style={{ color: '#52525e' }}>Total found</p>
              <p className="text-[20px] font-bold tracking-tight text-amber-400">{items.length}</p>
              <p className="text-[11px]" style={{ color: '#52525e' }}>network items</p>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <p className="text-[11px] font-medium" style={{ color: '#52525e' }}>Selected</p>
                <p className="text-[15px] font-semibold text-zinc-200">{selectedIds.size} items</p>
              </div>
            </div>
          )}
        </div>

        {/* Items panel */}
        <div className="flex-1 min-w-0">
          {isScanning && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <span className="text-[13px] text-zinc-400">Scanning network configuration...</span>
            </div>
          )}

          {isCleaning && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <span className="text-[13px] text-zinc-400">Cleaning selected items...</span>
            </div>
          )}

          {cleanResult && status === 'complete' && (
            <div
              className="mb-5 rounded-2xl p-4"
              style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">Cleanup complete!</p>
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    {cleanResult.cleaned} cleaned
                    {cleanResult.failed > 0 && <span> · {cleanResult.failed} failed</span>}
                  </p>
                </div>
              </div>
              {cleanResult.details.length > 0 && (
                <div className="mt-3 ml-8 space-y-0.5">
                  {cleanResult.details.map((detail, i) => (
                    <p key={i} className="text-[11px] font-mono" style={{ color: '#6e6e76' }}>{detail}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasItems && !isScanning && (
            <EmptyState
              icon={Search}
              title="No scan results"
              description='Click "Scan" to discover network items that can be cleaned.'
            />
          )}

          {hasItems && (
            <div key={activeCategory} className="space-y-2">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
                  {categories.find((c) => c.type === activeCategory)?.label}
                </span>
                {categoryItems.length > 0 && (
                  <button
                    onClick={() => toggleCategory(activeCategory)}
                    className="text-[12px] font-medium text-amber-500 hover:text-amber-400"
                  >
                    Toggle All
                  </button>
                )}
              </div>

              {categoryItems.length === 0 && (
                <div className="py-12 text-center text-[13px]" style={{ color: '#4e4e56' }}>
                  No items found in this category
                </div>
              )}

              <div className="space-y-1.5">
                {categoryItems.map((item) => {
                  const checked = selectedIds.has(item.id)
                  const CatIcon = categories.find((c) => c.type === item.type)?.icon || Network
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3.5 transition-all',
                        checked && 'ring-1 ring-amber-500/20'
                      )}
                      style={{
                        background: checked ? 'rgba(245,158,11,0.04)' : '#16161a',
                        border: '1px solid rgba(255,255,255,0.05)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.03)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.04)' : '#16161a'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.id)}
                        className="sr-only"
                      />
                      <div
                        className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] shrink-0"
                        style={{
                          background: checked ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                          border: checked ? 'none' : '1.5px solid rgba(255,255,255,0.12)'
                        }}
                      >
                        {checked && (
                          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6l2.5 2.5 4.5-5" stroke="#1a0a00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <CatIcon
                        className="h-4 w-4 shrink-0"
                        style={{ color: checked ? '#f59e0b' : '#4e4e56' }}
                        strokeWidth={1.8}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-zinc-300">{item.label}</p>
                        <p className="text-[11px] truncate" style={{ color: '#4e4e56' }}>{item.detail}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title="Clean Network Items"
        description={`This will clean ${selectedIds.size} network item${selectedIds.size === 1 ? '' : 's'}. DNS and ARP caches will rebuild automatically. Wi-Fi profiles and network history will be permanently removed.`}
        confirmLabel="Clean Now"
        variant="warning"
      />
    </div>
  )
}
