import { useState, useCallback, useRef, useEffect } from 'react'
import { PackageMinus, Search, Trash2, Shield, CheckCircle2, Package, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import type { BloatwareApp } from '@shared/types'

type FilterType = 'all' | BloatwareApp['category']

const categoryColors: Record<BloatwareApp['category'], { bg: string; text: string; label: string }> = {
  microsoft: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6', label: 'Microsoft' },
  oem: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', label: 'OEM' },
  gaming: { bg: 'rgba(168,85,247,0.1)', text: '#a855f7', label: 'Gaming' },
  media: { bg: 'rgba(236,72,153,0.1)', text: '#ec4899', label: 'Media' },
  communication: { bg: 'rgba(20,184,166,0.1)', text: '#14b8a6', label: 'Communication' },
  utility: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b', label: 'Utility' }
}

export function DebloaterPage() {
  const [apps, setApps] = useState<BloatwareApp[]>([])
  const [scanning, setScanning] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [showConfirm, setShowConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeProgress, setRemoveProgress] = useState<{ current: number; total: number; currentApp: string; status: string } | null>(null)
  const [removeResult, setRemoveResult] = useState<{ removed: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const removeStartRef = useRef<number>(0)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  useEffect(() => {
    const cleanup = window.dustforge.onDebloaterRemoveProgress((data) => {
      setRemoveProgress(data)
    })
    return cleanup
  }, [])

  const handleScan = useCallback(async () => {
    setScanning(true)
    setApps([])
    setRemoveResult(null)
    setError(null)
    try {
      const results = await window.dustforge.debloaterScan()
      setApps(results)
    } catch (err) {
      console.error('Debloater scan failed:', err)
      setError('Failed to scan for bloatware. Make sure PowerShell is available.')
    }
    setScanning(false)
  }, [])

  const handleRemove = useCallback(async () => {
    setShowConfirm(false)
    setRemoving(true)
    setRemoveResult(null)
    setRemoveProgress(null)
    removeStartRef.current = Date.now()
    const selectedApps = apps.filter((a) => a.selected)
    const selectedPkgs = selectedApps.map((a) => a.packageName)
    try {
      const result = await window.dustforge.debloaterRemove(selectedPkgs)
      setRemoveResult(result)

      // Build category breakdown by app category
      const byCategory: Record<string, { found: number; removed: number }> = {}
      for (const a of selectedApps) {
        const label = categoryColors[a.category]?.label || a.category
        if (!byCategory[label]) byCategory[label] = { found: 0, removed: 0 }
        byCategory[label].found++
      }
      const totalSelected = selectedApps.length
      for (const c in byCategory) {
        byCategory[c].removed = Math.round((byCategory[c].found / totalSelected) * result.removed)
      }

      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'debloater',
        timestamp: new Date().toISOString(),
        duration: Date.now() - removeStartRef.current,
        totalItemsFound: apps.length,
        totalItemsCleaned: result.removed,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byCategory).map(([name, d]) => ({
          name, itemsFound: d.found, itemsCleaned: d.removed, spaceSaved: 0
        })),
        errorCount: result.failed
      })
      recomputeStats()

      if (result.removed > 0) {
        setApps((prev) => prev.filter((a) => !a.selected || selectedPkgs.indexOf(a.packageName) === -1))
        const results = await window.dustforge.debloaterScan()
        setApps(results)
      }
    } catch (err) {
      console.error('Debloater remove failed:', err)
      setError('Failed to remove some apps. Administrator privileges may be required.')
    } finally {
      setRemoving(false)
      setRemoveProgress(null)
    }
  }, [apps])

  const toggleApp = (id: string) => setApps((prev) => prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)))
  const filtered = filter === 'all' ? apps : apps.filter((a) => a.category === filter)
  const selectedCount = apps.filter((a) => a.selected).length

  const filters: { label: string; value: FilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Microsoft', value: 'microsoft' },
    { label: 'OEM', value: 'oem' },
    { label: 'Gaming', value: 'gaming' },
    { label: 'Media', value: 'media' },
    { label: 'Communication', value: 'communication' },
    { label: 'Utility', value: 'utility' }
  ]

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Debloater"
        description="Remove pre-installed Windows apps and OEM bloatware"
        action={
          <div className="flex items-center gap-2.5">
            <button onClick={handleScan} disabled={scanning || removing}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Search className="h-4 w-4" strokeWidth={1.8} /> Scan
            </button>
            <button onClick={() => setShowConfirm(true)} disabled={selectedCount === 0 || scanning || removing}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: '#fff' }}>
              {removing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Trash2 className="h-4 w-4" strokeWidth={2} />}
              {removing ? 'Removing...' : `Remove (${selectedCount})`}
            </button>
          </div>
        }
      />

      {/* Warning */}
      <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}>
        <Shield className="h-5 w-5 shrink-0 text-red-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: '#8e8e96' }}>
          <span className="font-semibold text-red-500">Irreversible</span> — Removed apps can only be reinstalled from the Microsoft Store. Review selections carefully.
        </p>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} className="mb-5" />}

      {scanning && <ScanProgress status="scanning" progress={0} currentPath="Scanning installed packages..." className="mb-5" />}

      {removing && removeProgress && (
        <div className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-red-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                Removing {removeProgress.current} of {removeProgress.total}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: '#6e6e76' }}>
              {Math.round((removeProgress.current / removeProgress.total) * 100)}%
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${(removeProgress.current / removeProgress.total) * 100}%`,
                background: 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)'
              }} />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: '#6e6e76' }}>
            {apps.find((a) => a.packageName === removeProgress.currentApp)?.name || removeProgress.currentApp}
          </p>
        </div>
      )}

      {removeResult && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}>
          <CheckCircle2 className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <p className="text-[13px] text-zinc-200">
            Removed {removeResult.removed} app{removeResult.removed !== 1 ? 's' : ''}
            {removeResult.failed > 0 && <span className="text-red-400"> ({removeResult.failed} failed)</span>}
          </p>
        </div>
      )}

      {/* Filter pills */}
      {apps.length > 0 && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {filters.map((f) => {
            const count = f.value === 'all' ? apps.length : apps.filter((a) => a.category === f.value).length
            if (count === 0 && f.value !== 'all') return null
            return (
              <button key={f.value} onClick={() => setFilter(f.value)}
                className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: filter === f.value ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)',
                  color: filter === f.value ? '#f59e0b' : '#6e6e76'
                }}>
                {f.label} ({count})
              </button>
            )
          })}

          {/* Quick select buttons */}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setApps((prev) => prev.map((a) => ({ ...a, selected: true })))}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}>
              Select All
            </button>
            <button onClick={() => setApps((prev) => prev.map((a) => ({ ...a, selected: false })))}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}>
              Deselect All
            </button>
          </div>
        </div>
      )}

      {apps.length === 0 && !scanning && (
        <EmptyState icon={PackageMinus} title="No bloatware detected" description='Click "Scan" to find pre-installed apps and OEM bloatware.' />
      )}

      {/* App grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5">
          {/* Header with master checkbox */}
          <div className="flex items-center gap-4 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: '#4e4e56' }}>
            <div className="w-6">
              <input type="checkbox"
                checked={filtered.every((a) => a.selected)}
                onChange={() => {
                  const all = filtered.every((a) => a.selected)
                  setApps((prev) => prev.map((a) => {
                    const inFilter = filter === 'all' || a.category === filter
                    return inFilter ? { ...a, selected: !all } : a
                  }))
                }}
                className="accent-amber-500" />
            </div>
            <span>{filtered.length} app{filtered.length !== 1 ? 's' : ''} found</span>
          </div>

          {filtered.map((app) => (
            <div key={app.id}
              className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
              style={{
                background: app.selected ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${app.selected ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)'}`
              }}>
              {/* Checkbox */}
              <div className="w-6" onClick={() => toggleApp(app.id)}>
                <input type="checkbox" checked={app.selected} readOnly className="pointer-events-none accent-amber-500 cursor-pointer" />
              </div>

              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: categoryColors[app.category].bg }}>
                <Package className="h-5 w-5" style={{ color: categoryColors[app.category].text }} strokeWidth={1.8} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-medium text-zinc-200">{app.name}</span>
                  <span className="rounded-md px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: categoryColors[app.category].bg, color: categoryColors[app.category].text }}>
                    {categoryColors[app.category].label}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: '#6e6e76' }}>{app.description}</p>
              </div>

              {/* Publisher */}
              <div className="shrink-0 text-right">
                <span className="text-[11px] text-zinc-500">{app.publisher}</span>
                <div className="mt-0.5 text-[11px] font-mono" style={{ color: '#4e4e56' }}>{app.size}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog open={showConfirm} onConfirm={handleRemove} onCancel={() => setShowConfirm(false)}
        title="Remove Selected Apps" description={`This will permanently remove ${selectedCount} app${selectedCount !== 1 ? 's' : ''}. They can be reinstalled from the Microsoft Store if needed.`}
        confirmLabel="Remove Selected" variant="danger" />
    </div>
  )
}
