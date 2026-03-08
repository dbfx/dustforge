import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Cpu,
  Search,
  Trash2,
  Shield,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Download,
  ArrowUpCircle,
  RefreshCw
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useDriverStore } from '@/stores/driver-store'
import type {
  DriverPackage,
  DriverScanProgress,
  DriverCleanResult,
  DriverUpdate,
  DriverUpdateProgress,
  DriverUpdateInstallResult
} from '@shared/types'

type Tab = 'cleanup' | 'updates'
type FilterType = 'all' | 'stale' | 'current'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

// ─── Cleanup Tab ─────────────────────────────────────────────

function CleanupTab() {
  const packages = useDriverStore((s) => s.packages)
  const scanning = useDriverStore((s) => s.scanning)
  const scanProgress = useDriverStore((s) => s.scanProgress)
  const filter = useDriverStore((s) => s.filter)
  const cleaning = useDriverStore((s) => s.cleaning)
  const cleanResult = useDriverStore((s) => s.cleanResult)
  const error = useDriverStore((s) => s.error)
  const totalStaleSize = useDriverStore((s) => s.totalStaleSize)

  const [showConfirm, setShowConfirm] = useState(false)
  const cleanStartRef = useRef<number>(0)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  useEffect(() => {
    const cleanup = window.dustforge.onDriverProgress((data) => {
      useDriverStore.getState().setScanProgress(data)
    })
    return cleanup
  }, [])

  const handleScan = useCallback(async () => {
    const store = useDriverStore.getState()
    store.setScanning(true)
    store.setPackages([])
    store.setCleanResult(null)
    store.setError(null)
    store.setScanProgress(null)
    try {
      const result = await window.dustforge.driverScan()
      store.setPackages(result.packages)
      store.setTotalStaleSize(result.totalStaleSize)
    } catch (err) {
      console.error('Driver scan failed:', err)
      useDriverStore.getState().setError('Failed to scan driver packages. Make sure the app is running as Administrator.')
    }
    const s = useDriverStore.getState()
    s.setScanning(false)
    s.setScanProgress(null)
  }, [])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    const store = useDriverStore.getState()
    store.setCleaning(true)
    store.setCleanResult(null)
    cleanStartRef.current = Date.now()
    const currentPackages = useDriverStore.getState().packages
    const selected = currentPackages.filter((p) => p.selected && !p.isCurrent)
    const names = selected.map((p) => p.publishedName)
    try {
      const result = await window.dustforge.driverClean(names)
      useDriverStore.getState().setCleanResult(result)

      const byClass: Record<string, { found: number; cleaned: number; size: number }> = {}
      for (const pkg of selected) {
        if (!byClass[pkg.className]) byClass[pkg.className] = { found: 0, cleaned: 0, size: 0 }
        byClass[pkg.className].found++
        byClass[pkg.className].size += pkg.size
      }
      const totalSelected = selected.length
      for (const c in byClass) {
        byClass[c].cleaned = Math.round((byClass[c].found / totalSelected) * result.removed)
      }

      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'drivers',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: currentPackages.length,
        totalItemsCleaned: result.removed,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: result.spaceRecovered,
        categories: Object.entries(byClass).map(([name, d]) => ({
          name: `Drivers: ${name}`,
          itemsFound: d.found,
          itemsCleaned: d.cleaned,
          spaceSaved: d.size
        })),
        errorCount: result.failed
      })
      recomputeStats()

      if (result.removed > 0) {
        const fresh = await window.dustforge.driverScan()
        const s = useDriverStore.getState()
        s.setPackages(fresh.packages)
        s.setTotalStaleSize(fresh.totalStaleSize)
      }
    } catch (err) {
      console.error('Driver clean failed:', err)
      useDriverStore.getState().setError('Failed to remove driver packages. Administrator privileges are required.')
    } finally {
      useDriverStore.getState().setCleaning(false)
    }
  }, [])

  const filtered =
    filter === 'all'
      ? packages
      : filter === 'stale'
        ? packages.filter((p) => !p.isCurrent)
        : packages.filter((p) => p.isCurrent)

  const selectedCount = packages.filter((p) => p.selected && !p.isCurrent).length
  const staleCount = packages.filter((p) => !p.isCurrent).length
  const currentCount = packages.filter((p) => p.isCurrent).length

  const filters: { label: string; value: FilterType; count: number }[] = [
    { label: 'All', value: 'all', count: packages.length },
    { label: 'Stale', value: 'stale', count: staleCount },
    { label: 'Current', value: 'current', count: currentCount }
  ]

  return (
    <>
      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleScan}
          disabled={scanning || cleaning}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Search className="h-4 w-4" strokeWidth={1.8} /> Scan Stale
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={selectedCount === 0 || scanning || cleaning}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff' }}
        >
          {cleaning ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Trash2 className="h-4 w-4" strokeWidth={2} />}
          {cleaning ? 'Removing...' : `Clean (${selectedCount})`}
        </button>
      </div>

      {/* Info banner */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.08)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: '#8e8e96' }}>
          <span className="font-semibold text-amber-500">Safe cleanup</span> — Only removes old
          driver versions. The newest and currently active driver for each device is always kept.
        </p>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => useDriverStore.getState().setError(null)} className="mb-5" />}

      {scanning && scanProgress && (
        <ScanProgress
          status="scanning"
          progress={scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0}
          currentPath={scanProgress.currentDriver}
          className="mb-5"
        />
      )}
      {scanning && !scanProgress && (
        <ScanProgress status="scanning" progress={0} currentPath="Enumerating driver packages..." className="mb-5" />
      )}

      {packages.length > 0 && !scanning && totalStaleSize > 0 && (
        <div
          className="mb-5 flex items-center gap-4 rounded-2xl px-5 py-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div className="flex-1">
            <div className="text-[13px] font-medium text-zinc-300">
              {staleCount} stale driver package{staleCount !== 1 ? 's' : ''} found
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: '#6e6e76' }}>
              {formatSize(totalStaleSize)} can be recovered
            </div>
          </div>
          <div className="rounded-xl px-4 py-2 text-[15px] font-semibold text-amber-400" style={{ background: 'rgba(245,158,11,0.08)' }}>
            {formatSize(totalStaleSize)}
          </div>
        </div>
      )}

      {cleanResult && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl p-4" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}>
          <CheckCircle2 className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <p className="text-[13px] text-zinc-200">
            Removed {cleanResult.removed} driver package{cleanResult.removed !== 1 ? 's' : ''}
            {cleanResult.spaceRecovered > 0 && <span className="text-green-400"> — {formatSize(cleanResult.spaceRecovered)} recovered</span>}
            {cleanResult.failed > 0 && <span className="text-red-400"> ({cleanResult.failed} failed)</span>}
          </p>
        </div>
      )}

      {packages.length > 0 && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => useDriverStore.getState().setFilter(f.value)}
              className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                background: filter === f.value ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)',
                color: filter === f.value ? '#f59e0b' : '#6e6e76'
              }}
            >
              {f.label} ({f.count})
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => useDriverStore.getState().selectAllStale()}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
            >
              Select All Stale
            </button>
            <button
              onClick={() => useDriverStore.getState().deselectAll()}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {packages.length === 0 && !scanning && (
        <EmptyState
          icon={Cpu}
          title="No driver packages scanned"
          description='Detect old driver packages in the Windows DriverStore.'
          action={
            <button
              onClick={handleScan}
              disabled={cleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#1a0a00' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              Scan Stale Drivers
            </button>
          }
        />
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5">
          <div className="flex items-center gap-4 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#4e4e56' }}>
            <div className="w-6">
              <input
                type="checkbox"
                checked={filtered.filter((p) => !p.isCurrent).every((p) => p.selected)}
                disabled={filtered.every((p) => p.isCurrent)}
                onChange={() => {
                  const staleInFilter = filtered.filter((p) => !p.isCurrent)
                  const allSelected = staleInFilter.every((p) => p.selected)
                  const staleIds = new Set(staleInFilter.map((p) => p.id))
                  const store = useDriverStore.getState()
                  store.setPackages(
                    store.packages.map((p) => (staleIds.has(p.id) ? { ...p, selected: !allSelected } : p))
                  )
                }}
                className="accent-amber-500"
              />
            </div>
            <span>{filtered.length} package{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {filtered.map((pkg) => (
            <div
              key={pkg.id}
              className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
              style={{
                background: pkg.isCurrent ? 'rgba(34,197,94,0.03)' : pkg.selected ? 'rgba(245,158,11,0.04)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${pkg.isCurrent ? 'rgba(34,197,94,0.08)' : pkg.selected ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)'}`
              }}
            >
              <div className="w-6" onClick={() => useDriverStore.getState().togglePackage(pkg.id)}>
                {pkg.isCurrent ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" strokeWidth={2} />
                ) : (
                  <input type="checkbox" checked={pkg.selected} readOnly className="pointer-events-none accent-amber-500 cursor-pointer" />
                )}
              </div>
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: pkg.isCurrent ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)' }}
              >
                {pkg.isCurrent ? (
                  <Cpu className="h-5 w-5" style={{ color: '#22c55e' }} strokeWidth={1.8} />
                ) : (
                  <AlertTriangle className="h-5 w-5" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-medium text-zinc-200">{pkg.originalName}</span>
                  <span
                    className="rounded-md px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: pkg.isCurrent ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', color: pkg.isCurrent ? '#22c55e' : '#f59e0b' }}
                  >
                    {pkg.isCurrent ? 'Current' : 'Stale'}
                  </span>
                  <span className="rounded-md px-2 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa' }}>
                    {pkg.className}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: '#6e6e76' }}>
                  {pkg.provider} — v{pkg.version}{pkg.date ? ` — ${pkg.date}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-[12px] font-medium text-zinc-400">{formatSize(pkg.size)}</span>
                <div className="mt-0.5 text-[10px] font-mono" style={{ color: '#4e4e56' }}>{pkg.publishedName}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title="Remove Stale Driver Packages"
        description={`This will remove ${selectedCount} old driver package${selectedCount !== 1 ? 's' : ''} from the DriverStore. Currently active drivers will not be affected.`}
        confirmLabel="Remove Selected"
        variant="danger"
      />
    </>
  )
}

// ─── Updates Tab ─────────────────────────────────────────────

function UpdatesTab() {
  const updates = useDriverStore((s) => s.updates)
  const scanning = useDriverStore((s) => s.updateScanning)
  const scanProgress = useDriverStore((s) => s.updateProgress)
  const installing = useDriverStore((s) => s.installing)
  const installResult = useDriverStore((s) => s.installResult)
  const error = useDriverStore((s) => s.updateError)

  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    const cleanup = window.dustforge.onDriverUpdateProgress((data) => {
      useDriverStore.getState().setUpdateProgress(data)
    })
    return cleanup
  }, [])

  const handleCheckUpdates = useCallback(async () => {
    const store = useDriverStore.getState()
    store.setUpdateScanning(true)
    store.setUpdates([])
    store.setInstallResult(null)
    store.setUpdateError(null)
    store.setUpdateProgress(null)
    try {
      const result = await window.dustforge.driverUpdateScan()
      useDriverStore.getState().setUpdates(result.updates)
    } catch (err) {
      console.error('Driver update scan failed:', err)
      useDriverStore.getState().setUpdateError('Failed to check for driver updates. Make sure Windows Update service is running and the app has Administrator privileges.')
    }
    const s = useDriverStore.getState()
    s.setUpdateScanning(false)
    s.setUpdateProgress(null)
  }, [])

  const handleInstall = useCallback(async () => {
    setShowConfirm(false)
    const store = useDriverStore.getState()
    store.setInstalling(true)
    store.setInstallResult(null)
    store.setUpdateProgress(null)
    const currentUpdates = useDriverStore.getState().updates
    const selected = currentUpdates.filter((u) => u.selected)
    const ids = selected.map((u) => u.updateId)
    try {
      const result = await window.dustforge.driverUpdateInstall(ids)
      useDriverStore.getState().setInstallResult(result)

      // Re-scan after install
      if (result.installed > 0) {
        const fresh = await window.dustforge.driverUpdateScan()
        useDriverStore.getState().setUpdates(fresh.updates)
      }
    } catch (err) {
      console.error('Driver install failed:', err)
      useDriverStore.getState().setUpdateError('Failed to install driver updates. Administrator privileges are required.')
    } finally {
      const s = useDriverStore.getState()
      s.setInstalling(false)
      s.setUpdateProgress(null)
    }
  }, [])

  const selectedCount = updates.filter((u) => u.selected).length

  return (
    <>
      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleCheckUpdates}
          disabled={scanning || installing}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} strokeWidth={1.8} /> Check for Updates
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={selectedCount === 0 || scanning || installing}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: '#fff' }}
        >
          {installing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Download className="h-4 w-4" strokeWidth={2} />}
          {installing ? 'Installing...' : `Install (${selectedCount})`}
        </button>
      </div>

      {/* Info banner */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.08)' }}
      >
        <ArrowUpCircle className="h-5 w-5 shrink-0 text-blue-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: '#8e8e96' }}>
          <span className="font-semibold text-blue-500">Windows Update</span> — Checks for newer driver versions available through Windows Update. A reboot may be required after installing updates.
        </p>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => useDriverStore.getState().setUpdateError(null)} className="mb-5" />}

      {/* Scan/install progress */}
      {(scanning || installing) && scanProgress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.08)' }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {scanProgress.phase === 'checking'
                  ? 'Checking for updates...'
                  : scanProgress.phase === 'downloading'
                    ? 'Downloading drivers...'
                    : 'Installing drivers...'}
                {scanProgress.total > 0 && ` (${scanProgress.current}/${scanProgress.total})`}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: '#6e6e76' }}>
              {scanProgress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${scanProgress.percent}%`,
                background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)'
              }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: '#6e6e76' }}>
            {scanProgress.currentDevice}
          </p>
        </div>
      )}
      {scanning && !scanProgress && (
        <ScanProgress status="scanning" progress={0} currentPath="Querying Windows Update for driver updates..." className="mb-5" />
      )}

      {/* Install result */}
      {installResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
        >
          <CheckCircle2 className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <div className="text-[13px] text-zinc-200">
            <p>
              Installed {installResult.installed} driver update{installResult.installed !== 1 ? 's' : ''}
              {installResult.failed > 0 && <span className="text-red-400"> ({installResult.failed} failed)</span>}
            </p>
            {installResult.rebootRequired && (
              <p className="mt-1 text-[12px] text-amber-400">
                A system restart is required to complete the installation.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Update summary */}
      {updates.length > 0 && !scanning && (
        <div
          className="mb-5 flex items-center gap-4 rounded-2xl px-5 py-4"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div className="flex-1">
            <div className="text-[13px] font-medium text-zinc-300">
              {updates.length} driver update{updates.length !== 1 ? 's' : ''} available
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: '#6e6e76' }}>
              Select the updates you want to install
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => useDriverStore.getState().selectAllUpdates()}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
            >
              Select All
            </button>
            <button
              onClick={() => useDriverStore.getState().deselectAllUpdates()}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {updates.length === 0 && !scanning && (
        <EmptyState
          icon={ArrowUpCircle}
          title="No updates checked"
          description='Scan Windows Update for newer driver versions.'
          action={
            <button
              onClick={handleCheckUpdates}
              disabled={installing}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: '#fff' }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              Check for Updates
            </button>
          }
        />
      )}

      {/* Update list */}
      {updates.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5">
          <div className="flex items-center gap-4 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#4e4e56' }}>
            <div className="w-6">
              <input
                type="checkbox"
                checked={updates.every((u) => u.selected)}
                onChange={() => {
                  const allSelected = updates.every((u) => u.selected)
                  if (allSelected) {
                    useDriverStore.getState().deselectAllUpdates()
                  } else {
                    useDriverStore.getState().selectAllUpdates()
                  }
                }}
                className="accent-blue-500"
              />
            </div>
            <span>{updates.length} update{updates.length !== 1 ? 's' : ''} available</span>
          </div>

          {updates.map((upd) => (
            <div
              key={upd.id}
              className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
              style={{
                background: upd.selected ? 'rgba(59,130,246,0.04)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${upd.selected ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)'}`
              }}
            >
              <div className="w-6" onClick={() => useDriverStore.getState().toggleUpdate(upd.id)}>
                <input type="checkbox" checked={upd.selected} readOnly className="pointer-events-none accent-blue-500 cursor-pointer" />
              </div>
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(59,130,246,0.1)' }}
              >
                <ArrowUpCircle className="h-5 w-5" style={{ color: '#3b82f6' }} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-medium text-zinc-200">{upd.deviceName}</span>
                  <span className="rounded-md px-2 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>
                    {upd.className}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: '#6e6e76' }}>
                  {upd.provider} — {upd.currentVersion ? `v${upd.currentVersion}` : 'Unknown'} → v{upd.availableVersion}
                </p>
                <p className="mt-0.5 text-[11px] truncate" style={{ color: '#4e4e56' }}>
                  {upd.updateTitle}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {upd.downloadSize && (
                  <span className="text-[12px] font-medium text-zinc-400">{upd.downloadSize}</span>
                )}
                {upd.availableDate && (
                  <div className="mt-0.5 text-[10px] font-mono" style={{ color: '#4e4e56' }}>
                    {upd.availableDate}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleInstall}
        onCancel={() => setShowConfirm(false)}
        title="Install Driver Updates"
        description={`This will download and install ${selectedCount} driver update${selectedCount !== 1 ? 's' : ''} from Windows Update. A system restart may be required.`}
        confirmLabel="Install Selected"
        variant="danger"
      />
    </>
  )
}

// ─── Main Page ───────────────────────────────────────────────

export function DriverManagerPage() {
  const tab = useDriverStore((s) => s.tab)

  const tabs: { label: string; value: Tab; icon: typeof Cpu }[] = [
    { label: 'Cleanup', value: 'cleanup', icon: Trash2 },
    { label: 'Updates', value: 'updates', icon: Download }
  ]

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Driver Manager"
        description="Clean old driver packages and install available updates"
      />

      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.04)' }}>
        {tabs.map((t) => {
          const Icon = t.icon
          const isActive = tab === t.value
          return (
            <button
              key={t.value}
              onClick={() => useDriverStore.getState().setTab(t.value)}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13px] font-medium transition-all"
              style={{
                background: isActive ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: isActive ? '#f59e0b' : '#6e6e76'
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={isActive ? 2 : 1.8} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'cleanup' ? <CleanupTab /> : <UpdatesTab />}
    </div>
  )
}
