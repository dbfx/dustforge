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
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useDriverStore } from '@/stores/driver-store'
import type {
  DriverScanProgress,
  DriverUpdateProgress
} from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export function DriverManagerPage({ embedded }: { embedded?: boolean }) {
  const packages = useDriverStore((s) => s.packages)
  const scanning = useDriverStore((s) => s.scanning)
  const scanProgress = useDriverStore((s) => s.scanProgress)
  const cleaning = useDriverStore((s) => s.cleaning)
  const cleanResult = useDriverStore((s) => s.cleanResult)
  const error = useDriverStore((s) => s.error)
  const totalStaleSize = useDriverStore((s) => s.totalStaleSize)
  const updates = useDriverStore((s) => s.updates)
  const updateScanning = useDriverStore((s) => s.updateScanning)
  const updateProgress = useDriverStore((s) => s.updateProgress)
  const installing = useDriverStore((s) => s.installing)
  const installResult = useDriverStore((s) => s.installResult)
  const updateError = useDriverStore((s) => s.updateError)
  const applying = useDriverStore((s) => s.applying)
  const hasScanned = useDriverStore((s) => s.hasScanned)

  const [showConfirm, setShowConfirm] = useState(false)
  const cleanStartRef = useRef<number>(0)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  const isScanning = scanning || updateScanning
  const isBusy = isScanning || applying

  // Listen for progress events
  useEffect(() => {
    const cleanupDriver = window.dustforge.onDriverProgress((data: DriverScanProgress) => {
      useDriverStore.getState().setScanProgress(data)
    })
    const cleanupUpdate = window.dustforge.onDriverUpdateProgress((data: DriverUpdateProgress) => {
      useDriverStore.getState().setUpdateProgress(data)
    })
    return () => {
      cleanupDriver()
      cleanupUpdate()
    }
  }, [])

  // ─── Scan for both stale packages and updates ─────────────
  const handleScan = useCallback(async () => {
    const store = useDriverStore.getState()
    store.setScanning(true)
    store.setUpdateScanning(true)
    store.setPackages([])
    store.setUpdates([])
    store.setCleanResult(null)
    store.setInstallResult(null)
    store.setError(null)
    store.setUpdateError(null)
    store.setScanProgress(null)
    store.setUpdateProgress(null)

    // Run both scans in parallel
    const [staleResult, updateResult] = await Promise.allSettled([
      window.dustforge.driverScan(),
      window.dustforge.driverUpdateScan()
    ])

    const s = useDriverStore.getState()

    if (staleResult.status === 'fulfilled') {
      s.setPackages(staleResult.value.packages)
      s.setTotalStaleSize(staleResult.value.totalStaleSize)
      // Auto-select all stale packages
      useDriverStore.getState().selectAllStale()
    } else {
      console.error('Driver scan failed:', staleResult.reason)
      toast.error('Driver scan failed', { description: 'Make sure the app is running as Administrator' })
      s.setError('Failed to scan driver packages. Make sure the app is running as Administrator.')
    }

    if (updateResult.status === 'fulfilled') {
      s.setUpdates(updateResult.value.updates)
    } else {
      console.error('Driver update scan failed:', updateResult.reason)
      toast.error('Driver update check failed', { description: 'Make sure Windows Update service is running' })
      s.setUpdateError('Failed to check for driver updates. Make sure Windows Update service is running.')
    }

    const final = useDriverStore.getState()
    final.setScanning(false)
    final.setUpdateScanning(false)
    final.setScanProgress(null)
    final.setUpdateProgress(null)
    final.setHasScanned(true)
  }, [])

  // ─── Combined Update & Clean ──────────────────────────────
  const handleApply = useCallback(async () => {
    setShowConfirm(false)
    const store = useDriverStore.getState()
    store.setApplying(true)
    store.setCleanResult(null)
    store.setInstallResult(null)
    cleanStartRef.current = Date.now()

    const selectedUpdates = store.updates.filter((u) => u.selected)
    const selectedStale = store.packages.filter((p) => p.selected && !p.isCurrent)

    // Step 1: Install driver updates (if any selected)
    if (selectedUpdates.length > 0) {
      store.setInstalling(true)
      store.setUpdateProgress(null)
      const ids = selectedUpdates.map((u) => u.updateId)
      try {
        const result = await window.dustforge.driverUpdateInstall(ids)
        useDriverStore.getState().setInstallResult(result)
      } catch (err) {
        console.error('Driver install failed:', err)
        toast.error('Driver install failed', { description: 'Administrator privileges are required' })
        useDriverStore.getState().setUpdateError('Failed to install driver updates. Administrator privileges are required.')
      } finally {
        const s = useDriverStore.getState()
        s.setInstalling(false)
        s.setUpdateProgress(null)
      }
    }

    // Step 2: Clean stale packages (if any selected)
    if (selectedStale.length > 0) {
      const s2 = useDriverStore.getState()
      s2.setCleaning(true)
      const names = selectedStale.map((p) => p.publishedName)
      try {
        const result = await window.dustforge.driverClean(names)
        useDriverStore.getState().setCleanResult(result)

        // History tracking
        const byClass: Record<string, { found: number; cleaned: number; size: number }> = {}
        for (const pkg of selectedStale) {
          if (!byClass[pkg.className]) byClass[pkg.className] = { found: 0, cleaned: 0, size: 0 }
          byClass[pkg.className].found++
          byClass[pkg.className].size += pkg.size
        }
        const totalSelected = selectedStale.length
        for (const c in byClass) {
          byClass[c].cleaned = Math.round((byClass[c].found / totalSelected) * result.removed)
        }

        await historyStore.addEntry({
          id: Date.now().toString(),
          type: 'drivers',
          timestamp: new Date().toISOString(),
          duration: Date.now() - cleanStartRef.current,
          totalItemsFound: store.packages.length,
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
      } catch (err) {
        console.error('Driver clean failed:', err)
        toast.error('Driver cleanup failed', { description: 'Administrator privileges are required' })
        useDriverStore.getState().setError('Failed to remove driver packages. Administrator privileges are required.')
      } finally {
        useDriverStore.getState().setCleaning(false)
      }
    }

    // Step 3: Re-scan to refresh the list
    useDriverStore.getState().setApplying(false)
    const finalStore = useDriverStore.getState()
    const didInstall = finalStore.installResult && finalStore.installResult.installed > 0
    const didClean = finalStore.cleanResult && finalStore.cleanResult.removed > 0
    if (didInstall || didClean) {
      // Quick refresh
      finalStore.setScanning(true)
      finalStore.setUpdateScanning(true)
      const [staleResult, updateResult] = await Promise.allSettled([
        window.dustforge.driverScan(),
        window.dustforge.driverUpdateScan()
      ])
      const s = useDriverStore.getState()
      if (staleResult.status === 'fulfilled') {
        s.setPackages(staleResult.value.packages)
        s.setTotalStaleSize(staleResult.value.totalStaleSize)
        useDriverStore.getState().selectAllStale()
      }
      if (updateResult.status === 'fulfilled') {
        s.setUpdates(updateResult.value.updates)
      }
      s.setScanning(false)
      s.setUpdateScanning(false)
      s.setScanProgress(null)
      s.setUpdateProgress(null)
    }
  }, [])

  const stalePackages = packages.filter((p) => !p.isCurrent)
  const selectedStaleCount = stalePackages.filter((p) => p.selected).length
  const selectedUpdateCount = updates.filter((u) => u.selected).length
  const totalSelected = selectedStaleCount + selectedUpdateCount
  const allStaleSelected = stalePackages.length > 0 && stalePackages.every((p) => p.selected)
  const allUpdatesSelected = updates.length > 0 && updates.every((u) => u.selected)

  // Build confirmation description
  const confirmParts: string[] = []
  if (selectedUpdateCount > 0) {
    confirmParts.push(`install ${selectedUpdateCount} driver update${selectedUpdateCount !== 1 ? 's' : ''}`)
  }
  if (selectedStaleCount > 0) {
    confirmParts.push(`remove ${selectedStaleCount} stale driver package${selectedStaleCount !== 1 ? 's' : ''}`)
  }
  const confirmDesc = `This will ${confirmParts.join(' and ')}. ${selectedUpdateCount > 0 ? 'A system restart may be required after installing updates. ' : ''}Currently active drivers will not be affected.`

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader
          title="Driver Manager"
          description="Scan for outdated drivers, install updates, and clean stale packages — all in one step"
        />
      )}

      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleScan}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Search className={`h-4 w-4 ${isScanning ? 'animate-pulse' : ''}`} strokeWidth={1.8} />
          {isScanning ? 'Scanning...' : 'Scan Drivers'}
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={totalSelected === 0 || isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff' }}
        >
          {applying ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          )}
          {applying
            ? installing
              ? 'Installing...'
              : cleaning
                ? 'Cleaning...'
                : 'Applying...'
            : `Update & Clean (${totalSelected})`}
        </button>
      </div>

      {/* Info banner */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.08)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: '#8e8e96' }}>
          <span className="font-semibold text-amber-500">Safe operation</span> — Installs newer
          driver versions from Windows Update and removes old driver packages. Active drivers are
          never touched.
        </p>
      </div>

      {/* Errors */}
      {error && <ErrorAlert message={error} onDismiss={() => useDriverStore.getState().setError(null)} className="mb-5" />}
      {updateError && <ErrorAlert message={updateError} onDismiss={() => useDriverStore.getState().setUpdateError(null)} className="mb-5" />}

      {/* Scan progress */}
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

      {/* Update progress (during scan or install) */}
      {(updateScanning || installing) && updateProgress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.08)' }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {updateProgress.phase === 'checking'
                  ? 'Checking for updates...'
                  : updateProgress.phase === 'downloading'
                    ? 'Downloading drivers...'
                    : 'Installing drivers...'}
                {updateProgress.total > 0 && ` (${updateProgress.current}/${updateProgress.total})`}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: '#6e6e76' }}>
              {updateProgress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${updateProgress.percent}%`,
                background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)'
              }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: '#6e6e76' }}>
            {updateProgress.currentDevice}
          </p>
        </div>
      )}
      {updateScanning && !updateProgress && !scanning && (
        <ScanProgress status="scanning" progress={0} currentPath="Querying Windows Update for driver updates..." className="mb-5" />
      )}

      {/* Results summary */}
      {installResult && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl p-4" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}>
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
      {cleanResult && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl p-4" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}>
          <CheckCircle2 className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <p className="text-[13px] text-zinc-200">
            Removed {cleanResult.removed} stale package{cleanResult.removed !== 1 ? 's' : ''}
            {cleanResult.spaceRecovered > 0 && <span className="text-green-400"> — {formatSize(cleanResult.spaceRecovered)} recovered</span>}
            {cleanResult.failed > 0 && <span className="text-red-400"> ({cleanResult.failed} failed)</span>}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!hasScanned && !isScanning && (
        <EmptyState
          icon={Cpu}
          title="No drivers scanned yet"
          description="Scan to find available updates and stale driver packages to clean up."
          action={
            <button
              onClick={handleScan}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#1a0a00' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              Scan Drivers
            </button>
          }
        />
      )}

      {/* All up to date state */}
      {hasScanned && !isScanning && updates.length === 0 && stalePackages.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-16 rounded-2xl"
          style={{ background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.08)' }}
        >
          <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-zinc-200">All drivers are up to date</p>
          <p className="mt-1 text-[12px]" style={{ color: '#6e6e76' }}>No updates available and no stale packages found.</p>
        </div>
      )}

      {/* ─── Updates Section ──────────────────────────────────── */}
      {updates.length > 0 && !isScanning && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ArrowUpCircle className="h-4.5 w-4.5 text-blue-400" strokeWidth={1.8} />
              <span className="text-[13px] font-semibold text-zinc-200">
                Updates Available ({updates.length})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => allUpdatesSelected ? useDriverStore.getState().deselectAllUpdates() : useDriverStore.getState().selectAllUpdates()}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
              >
                {allUpdatesSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {updates.map((upd) => (
              <div
                key={upd.id}
                onClick={() => useDriverStore.getState().toggleUpdate(upd.id)}
                className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors cursor-pointer"
                style={{
                  background: upd.selected ? 'rgba(59,130,246,0.04)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${upd.selected ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)'}`
                }}
              >
                <div className="w-6">
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
        </div>
      )}

      {/* ─── Stale Packages Section ──────────────────────────── */}
      {stalePackages.length > 0 && !isScanning && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Trash2 className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              <span className="text-[13px] font-semibold text-zinc-200">
                Stale Packages ({stalePackages.length})
              </span>
              {totalStaleSize > 0 && (
                <span className="rounded-md px-2 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                  {formatSize(totalStaleSize)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => allStaleSelected ? useDriverStore.getState().deselectAllStale() : useDriverStore.getState().selectAllStale()}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
              >
                {allStaleSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {stalePackages.map((pkg) => (
              <div
                key={pkg.id}
                onClick={() => useDriverStore.getState().togglePackage(pkg.id)}
                className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors cursor-pointer"
                style={{
                  background: pkg.selected ? 'rgba(245,158,11,0.04)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${pkg.selected ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)'}`
                }}
              >
                <div className="w-6">
                  <input type="checkbox" checked={pkg.selected} readOnly className="pointer-events-none accent-amber-500 cursor-pointer" />
                </div>
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'rgba(245,158,11,0.1)' }}
                >
                  <AlertTriangle className="h-5 w-5" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-medium text-zinc-200">{pkg.originalName}</span>
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
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleApply}
        onCancel={() => setShowConfirm(false)}
        title="Update & Clean Drivers"
        description={confirmDesc}
        confirmLabel="Update & Clean"
        variant="danger"
      />
    </div>
  )
}
