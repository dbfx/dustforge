import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Package,
  Search,
  Loader2,
  CheckCircle2,
  Shield,
  Trash2,
  RefreshCw,
  ArrowUpDown,
  ChevronDown,
  AlertTriangle,
  Clock,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useUninstallerStore, UNUSED_THRESHOLD_DAYS } from '@/stores/uninstaller-store'
import type { InstalledProgram, UninstallProgress } from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes <= 0) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return ''
  const year = raw.substring(0, 4)
  const month = raw.substring(4, 6)
  const day = raw.substring(6, 8)
  return `${year}-${month}-${day}`
}

const UNUSED_THRESHOLD_MS = UNUSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000

function isUnused(prog: InstalledProgram): boolean {
  if (prog.lastUsed === -1) return false // unknown (Prefetch unavailable)
  if (prog.lastUsed === 0) return true // Prefetch available but never seen
  return Date.now() - prog.lastUsed > UNUSED_THRESHOLD_MS
}

function formatLastUsed(ts: number): string {
  if (ts <= 0) return 'Never detected'
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

const SORT_LABELS: Record<string, string> = {
  displayName: 'Name',
  estimatedSize: 'Size',
  installDate: 'Date',
  publisher: 'Publisher',
}

export function UninstallerPage() {
  const programs = useUninstallerStore((s) => s.programs)
  const loading = useUninstallerStore((s) => s.loading)
  const uninstalling = useUninstallerStore((s) => s.uninstalling)
  const progress = useUninstallerStore((s) => s.progress)
  const uninstallResult = useUninstallerStore((s) => s.uninstallResult)
  const error = useUninstallerStore((s) => s.error)
  const hasLoaded = useUninstallerStore((s) => s.hasLoaded)
  const searchQuery = useUninstallerStore((s) => s.searchQuery)
  const sortField = useUninstallerStore((s) => s.sortField)
  const sortDirection = useUninstallerStore((s) => s.sortDirection)
  const filterMode = useUninstallerStore((s) => s.filterMode)

  const [confirmProgram, setConfirmProgram] = useState<InstalledProgram | null>(null)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const uninstallStartRef = useRef<number>(0)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.dustforge.onUninstallerProgress((data: UninstallProgress) => {
      useUninstallerStore.getState().setProgress(data)
    })
    return () => { cleanup() }
  }, [])

  // Auto-load on first visit
  useEffect(() => {
    if (!hasLoaded && !loading) handleLoad()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close sort menu on click outside
  useEffect(() => {
    if (!showSortMenu) return
    const handler = (e: globalThis.MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu])

  // ─── Load programs ─────────────────────────────────────────
  const handleLoad = useCallback(async () => {
    const store = useUninstallerStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUninstallResult(null)

    try {
      const result = await window.dustforge.uninstallerList()
      const s = useUninstallerStore.getState()
      s.setPrograms(result.programs)
      s.setHasLoaded(true)
    } catch (err) {
      console.error('Failed to list programs:', err)
      useUninstallerStore.getState().setError('Failed to load installed programs.')
    } finally {
      useUninstallerStore.getState().setLoading(false)
    }
  }, [])

  // ─── Uninstall a program ──────────────────────────────────
  const handleUninstall = useCallback(async () => {
    if (!confirmProgram) return
    const program = confirmProgram
    setConfirmProgram(null)

    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()

    try {
      const result = await window.dustforge.uninstallerUninstall(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)

      if (result.success) {
        // Remove from list
        s.removeProgram(program.id)

        // Record in history if leftovers were cleaned
        if (result.leftoversCleaned > 0) {
          await historyStore.addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Uninstall: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize,
              },
            ],
            errorCount: 0,
          })
          recomputeStats()
        }
      }
    } catch (err) {
      console.error('Uninstall failed:', err)
      useUninstallerStore.getState().setError('Uninstall operation failed unexpectedly.')
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmProgram, historyStore, recomputeStats])

  // ─── Filtered & sorted list ───────────────────────────────
  const filteredPrograms = useMemo(() => {
    let list = programs

    // Filter by unused
    if (filterMode === 'unused') {
      list = list.filter(isUnused)
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.publisher.toLowerCase().includes(q),
      )
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'estimatedSize':
          return (a.estimatedSize - b.estimatedSize) * dir
        case 'installDate':
          return a.installDate.localeCompare(b.installDate) * dir
        case 'publisher':
          return a.publisher.localeCompare(b.publisher) * dir
        default:
          return a.displayName.localeCompare(b.displayName) * dir
      }
    })
  }, [programs, searchQuery, sortField, sortDirection, filterMode])

  // Unused stats — only meaningful when Prefetch data is available
  const hasPrefetchData = useMemo(() => programs.some((p) => p.lastUsed !== -1), [programs])
  const unusedPrograms = useMemo(() => programs.filter(isUnused), [programs])
  const unusedTotalSize = useMemo(
    () => unusedPrograms.reduce((sum, p) => sum + p.estimatedSize, 0),
    [unusedPrograms],
  )

  const isBusy = loading || uninstalling

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Program Uninstaller"
        description="Uninstall programs and automatically clean leftover files"
      />

      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleLoad}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
          )}
          {loading ? 'Loading...' : hasLoaded ? 'Refresh' : 'Load Programs'}
        </button>

        {/* Filter tabs — only show when Prefetch data is available */}
        {hasLoaded && hasPrefetchData && (
          <div
            className="flex rounded-xl overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <button
              onClick={() => useUninstallerStore.getState().setFilterMode('all')}
              className="px-4 py-2.5 text-[12px] font-medium transition-colors"
              style={{
                background: filterMode === 'all' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                color: filterMode === 'all' ? '#e4e4e7' : '#6e6e76',
              }}
            >
              All ({programs.length})
            </button>
            <button
              onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors"
              style={{
                background: filterMode === 'unused' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                color: filterMode === 'unused' ? '#fbbf24' : '#6e6e76',
                borderLeft: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              Unused ({unusedPrograms.length})
            </button>
          </div>
        )}

        {/* Search */}
        {hasLoaded && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-2.5"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => useUninstallerStore.getState().setSearchQuery(e.target.value)}
              placeholder="Search programs..."
              className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-48"
            />
          </div>
        )}

        {/* Sort */}
        {hasLoaded && (
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
              {SORT_LABELS[sortField]}
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
            {showSortMenu && (
              <div
                className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
                style={{ background: '#1e1e22', border: '1px solid rgba(255,255,255,0.08)', minWidth: 140 }}
              >
                {Object.entries(SORT_LABELS).map(([field, label]) => (
                  <button
                    key={field}
                    onClick={() => {
                      const store = useUninstallerStore.getState()
                      if (sortField === field) {
                        store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                      } else {
                        store.setSortField(field as any)
                        store.setSortDirection(field === 'estimatedSize' ? 'desc' : 'asc')
                      }
                      setShowSortMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    {label}
                    {sortField === field && (
                      <span className="ml-auto text-amber-400 text-[10px]">
                        {sortDirection === 'asc' ? 'A-Z' : 'Z-A'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unused recommendation banner */}
      {hasLoaded && !loading && hasPrefetchData && unusedPrograms.length > 0 && filterMode === 'all' && (
        <div
          className="mb-5 flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-colors hover:border-amber-500/20"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid rgba(245,158,11,0.08)',
          }}
          onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">
                {unusedPrograms.length} program{unusedPrograms.length !== 1 ? 's' : ''} not used in {UNUSED_THRESHOLD_DAYS}+ days
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: '#6e6e76' }}>
                {unusedTotalSize > 0
                  ? `Using ~${formatSize(unusedTotalSize)} of disk space. Click to view.`
                  : 'Click to view unused programs.'}
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-3 py-1 text-[11px] font-medium"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}
          >
            View
          </span>
        </div>
      )}

      {/* Info banner */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{
          background: 'rgba(245,158,11,0.04)',
          border: '1px solid rgba(245,158,11,0.08)',
        }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: '#8e8e96' }}>
          <span className="font-semibold text-amber-500">Safe uninstall</span> — Runs each
          program's native uninstaller, then automatically scans for and cleans leftover files and
          folders.
        </p>
      </div>

      {/* Errors */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useUninstallerStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* Uninstall progress */}
      {uninstalling && progress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid rgba(245,158,11,0.08)',
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {progress.phase === 'uninstalling'
                  ? `Uninstalling ${progress.currentProgram}...`
                  : progress.phase === 'scanning-leftovers'
                    ? 'Scanning for leftover files...'
                    : progress.phase === 'cleaning-leftovers'
                      ? 'Cleaning leftover files...'
                      : 'Loading...'}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: '#6e6e76' }}>
              {progress.progress}%
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.progress}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
              }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: '#6e6e76' }}>
            {progress.detail}
          </p>
        </div>
      )}

      {/* Uninstall result */}
      {uninstallResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background: uninstallResult.success
              ? 'rgba(34,197,94,0.06)'
              : 'rgba(239,68,68,0.06)',
            border: `1px solid ${uninstallResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          {uninstallResult.success ? (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          ) : (
            <Shield className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {uninstallResult.success ? (
              <p>
                Successfully uninstalled{' '}
                <span className="font-medium">{uninstallResult.programName}</span>
                {uninstallResult.leftoversCleaned > 0 && (
                  <span className="text-green-400">
                    {' '}
                    — {uninstallResult.leftoversCleaned} leftover
                    {uninstallResult.leftoversCleaned !== 1 ? 's' : ''} cleaned (
                    {formatSize(uninstallResult.leftoversSize)} recovered)
                  </span>
                )}
                {uninstallResult.leftoversFound === 0 && (
                  <span style={{ color: '#6e6e76' }}> — no leftover files found</span>
                )}
              </p>
            ) : (
              <p>
                Failed to uninstall{' '}
                <span className="font-medium">{uninstallResult.programName}</span>
                {uninstallResult.error && (
                  <span style={{ color: '#8e8e96' }}> — {uninstallResult.error}</span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasLoaded && !loading && (
        <EmptyState
          icon={Package}
          title="No programs loaded"
          description="Load the list of installed programs to view, search, and uninstall them."
          action={
            <button
              onClick={handleLoad}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#1a0a00',
              }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              Load Programs
            </button>
          }
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-400 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">Loading installed programs...</p>
        </div>
      )}

      {/* Program list */}
      {hasLoaded && !loading && filteredPrograms.length === 0 && programs.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="h-10 w-10 text-zinc-600 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">
            {filterMode === 'unused' ? 'No unused programs found' : 'No programs match your search'}
          </p>
        </div>
      )}

      {hasLoaded && !loading && programs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <CheckCircle2 className="h-10 w-10 text-green-500 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">No programs found in the registry</p>
        </div>
      )}

      {hasLoaded && !loading && filteredPrograms.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2.5">
            {filterMode === 'unused' ? (
              <AlertTriangle className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            ) : (
              <Package className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            )}
            <span className="text-[13px] font-semibold text-zinc-200">
              {filterMode === 'unused' ? 'Unused Programs' : 'Installed Programs'} ({filteredPrograms.length}
              {searchQuery && ` of ${filterMode === 'unused' ? unusedPrograms.length : programs.length}`})
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {filteredPrograms.map((prog) => {
              const unused = isUnused(prog)
              return (
                <div
                  key={prog.id}
                  className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
                  style={{
                    background: unused ? 'rgba(245,158,11,0.03)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${unused ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.04)'}`,
                  }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: unused ? 'rgba(245,158,11,0.1)' : 'rgba(139,92,246,0.1)' }}
                  >
                    {unused ? (
                      <AlertTriangle className="h-5 w-5" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
                    ) : (
                      <Package className="h-5 w-5" style={{ color: '#a78bfa' }} strokeWidth={1.8} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[13px] font-medium text-zinc-200 truncate">
                        {prog.displayName}
                      </span>
                      {prog.displayVersion && (
                        <span
                          className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                          style={{ background: 'rgba(255,255,255,0.05)', color: '#6e6e76' }}
                        >
                          v{prog.displayVersion}
                        </span>
                      )}
                      {unused && (
                        <span
                          className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}
                        >
                          Unused
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3">
                      <p className="text-[11px] truncate" style={{ color: '#6e6e76' }}>
                        {prog.publisher || 'Unknown publisher'}
                        {prog.installDate ? ` — ${formatDate(prog.installDate)}` : ''}
                      </p>
                      {prog.lastUsed > 0 && (
                        <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: unused ? '#f59e0b' : '#4e4e56' }}>
                          <Clock className="h-3 w-3" strokeWidth={1.8} />
                          {formatLastUsed(prog.lastUsed)}
                        </span>
                      )}
                      {prog.lastUsed === 0 && filterMode === 'unused' && (
                        <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: '#f59e0b' }}>
                          <Clock className="h-3 w-3" strokeWidth={1.8} />
                          Never detected
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-[12px] font-medium text-zinc-400">
                        {formatSize(prog.estimatedSize)}
                      </span>
                    </div>
                    <button
                      onClick={() => setConfirmProgram(prog)}
                      disabled={uninstalling}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:bg-red-500/10 disabled:opacity-30"
                      style={{ border: '1px solid rgba(239,68,68,0.15)' }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Uninstall
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmProgram}
        onConfirm={handleUninstall}
        onCancel={() => setConfirmProgram(null)}
        title={`Uninstall ${confirmProgram?.displayName ?? ''}?`}
        description={`This will run the program's native uninstaller. After completion, DustForge will scan for and clean leftover files automatically.`}
        confirmLabel="Uninstall"
        variant="danger"
      />
    </div>
  )
}
