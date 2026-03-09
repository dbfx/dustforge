import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Package,
  ArrowRight,
  Sparkles,
  XCircle,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { useUpdaterStore, severityOrder } from '@/stores/updater-store'
import { useHistoryStore } from '@/stores/history-store'
import type { UpdateProgress, UpdatableApp, UpToDateApp } from '@shared/types'

const SEVERITY_STYLES = {
  major: {
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.18)',
    text: '#f87171',
    label: 'Major',
  },
  minor: {
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.18)',
    text: '#fbbf24',
    label: 'Minor',
  },
  patch: {
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.18)',
    text: '#4ade80',
    label: 'Patch',
  },
  unknown: {
    bg: 'rgba(113,113,122,0.08)',
    border: 'rgba(113,113,122,0.18)',
    text: '#a1a1aa',
    label: 'Update',
  },
}

const SORT_LABELS: Record<string, string> = {
  name: 'Name',
  severity: 'Severity',
  source: 'Source',
}

const FILTER_LABELS: Record<string, string> = {
  all: 'All',
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
}

export function SoftwareUpdaterPage() {
  const apps = useUpdaterStore((s) => s.apps)
  const loading = useUpdaterStore((s) => s.loading)
  const updating = useUpdaterStore((s) => s.updating)
  const progress = useUpdaterStore((s) => s.progress)
  const updateResult = useUpdaterStore((s) => s.updateResult)
  const error = useUpdaterStore((s) => s.error)
  const hasChecked = useUpdaterStore((s) => s.hasChecked)
  const wingetAvailable = useUpdaterStore((s) => s.wingetAvailable)
  const searchQuery = useUpdaterStore((s) => s.searchQuery)
  const sortField = useUpdaterStore((s) => s.sortField)
  const sortDirection = useUpdaterStore((s) => s.sortDirection)
  const severityFilter = useUpdaterStore((s) => s.severityFilter)

  const upToDate = useUpdaterStore((s) => s.upToDate)

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showUpToDate, setShowUpToDate] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.dustforge.onSoftwareUpdateProgress((data: UpdateProgress) => {
      useUpdaterStore.getState().setProgress(data)
    })
    return () => {
      cleanup()
    }
  }, [])

  // Auto-scan on first visit
  useEffect(() => {
    if (!hasChecked && !loading) handleCheck()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close menus on outside click
  useEffect(() => {
    if (!showSortMenu && !showFilterMenu) return
    const handler = (e: globalThis.MouseEvent) => {
      if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node))
        setShowSortMenu(false)
      if (
        showFilterMenu &&
        filterMenuRef.current &&
        !filterMenuRef.current.contains(e.target as Node)
      )
        setShowFilterMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu, showFilterMenu])

  // ─── Check for updates ──────────────────────────────────────
  const handleCheck = useCallback(async () => {
    const store = useUpdaterStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUpdateResult(null)

    try {
      const result = await window.dustforge.softwareUpdateCheck()
      const s = useUpdaterStore.getState()
      s.setApps(result.apps)
      s.setUpToDate(result.upToDate)
      s.setWingetAvailable(result.wingetAvailable)
      s.setHasChecked(true)

      if (result.wingetAvailable && result.totalCount === 0) {
        toast.success('All software is up to date!')
      } else if (result.totalCount > 0) {
        toast.info(`Found ${result.totalCount} update${result.totalCount !== 1 ? 's' : ''} available`)
      }
    } catch (err) {
      console.error('Update check failed:', err)
      useUpdaterStore.getState().setError('Failed to check for updates.')
    } finally {
      useUpdaterStore.getState().setLoading(false)
    }
  }, [])

  // ─── Run updates ────────────────────────────────────────────
  const handleUpdate = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const store = useUpdaterStore.getState()
      store.setUpdating(true)
      store.setUpdateResult(null)
      store.setError(null)
      store.setProgress(null)

      const startTime = Date.now()
      const appsToUpdate = store.apps.filter(a => ids.includes(a.id))

      try {
        const result = await window.dustforge.softwareUpdateRun(ids)
        const s = useUpdaterStore.getState()
        s.setUpdateResult(result)
        s.setProgress(null)

        if (result.succeeded > 0) {
          // Remove successfully updated apps from the list
          const failedIds = new Set(result.errors.map((e) => e.appId))
          const succeededIds = ids.filter((id) => !failedIds.has(id))
          s.removeApps(succeededIds)
          toast.success(
            `Updated ${result.succeeded} app${result.succeeded !== 1 ? 's' : ''} successfully`,
          )
        }
        if (result.failed > 0) {
          toast.error(
            `${result.failed} update${result.failed !== 1 ? 's' : ''} failed`,
          )
        }

        // Log to history
        const bySeverity: Record<string, { found: number; updated: number }> = {}
        const failedAppIds = new Set(result.errors.map(e => e.appId))
        for (const app of appsToUpdate) {
          const sev = app.severity
          if (!bySeverity[sev]) bySeverity[sev] = { found: 0, updated: 0 }
          bySeverity[sev].found++
          if (!failedAppIds.has(app.id)) bySeverity[sev].updated++
        }
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'software-update',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: ids.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: Object.entries(bySeverity).map(([name, d]) => ({
            name: `${name} updates`, itemsFound: d.found, itemsCleaned: d.updated, spaceSaved: 0
          })),
          errorCount: result.failed
        })
      } catch (err) {
        console.error('Update failed:', err)
        useUpdaterStore.getState().setError('Update operation failed unexpectedly.')
      } finally {
        useUpdaterStore.getState().setUpdating(false)
      }
    },
    [],
  )

  const handleUpdateSelected = useCallback(() => {
    const selectedIds = useUpdaterStore.getState().apps.filter((a) => a.selected).map((a) => a.id)
    handleUpdate(selectedIds)
  }, [handleUpdate])

  // ─── Filtered & sorted list ─────────────────────────────────
  const filteredApps = useMemo(() => {
    let list = apps

    if (severityFilter !== 'all') {
      list = list.filter((a) => a.severity === severityFilter)
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
      )
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'severity':
          return (severityOrder[a.severity] - severityOrder[b.severity]) * dir
        case 'source':
          return a.source.localeCompare(b.source) * dir
        default:
          return a.name.localeCompare(b.name) * dir
      }
    })
  }, [apps, searchQuery, sortField, sortDirection, severityFilter])

  const selectedCount = apps.filter((a) => a.selected).length
  const allSelected = apps.length > 0 && selectedCount === apps.length
  const isBusy = loading || updating

  const majorCount = apps.filter((a) => a.severity === 'major').length
  const minorCount = apps.filter((a) => a.severity === 'minor').length
  const patchCount = apps.filter((a) => a.severity === 'patch').length

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Software Updater"
        description="Check for outdated software and install updates via winget"
      />

      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleCheck}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: '#1a0a00',
          }}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          )}
          {loading ? 'Checking...' : hasChecked ? 'Re-check' : 'Check for Updates'}
        </button>

        {/* Search */}
        {hasChecked && apps.length > 0 && (
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
              onChange={(e) => useUpdaterStore.getState().setSearchQuery(e.target.value)}
              placeholder="Search apps..."
              className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-48"
            />
          </div>
        )}

        {/* Severity filter */}
        {hasChecked && apps.length > 0 && (
          <div className="relative" ref={filterMenuRef}>
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.8} />
              {FILTER_LABELS[severityFilter]}
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
            {showFilterMenu && (
              <div
                className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
                style={{
                  background: '#1e1e22',
                  border: '1px solid rgba(255,255,255,0.08)',
                  minWidth: 120,
                }}
              >
                {Object.entries(FILTER_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      useUpdaterStore.getState().setSeverityFilter(key as any)
                      setShowFilterMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    {label}
                    {severityFilter === key && (
                      <CheckCircle2 className="ml-auto h-3 w-3 text-amber-400" strokeWidth={2} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sort */}
        {hasChecked && apps.length > 0 && (
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
                style={{
                  background: '#1e1e22',
                  border: '1px solid rgba(255,255,255,0.08)',
                  minWidth: 140,
                }}
              >
                {Object.entries(SORT_LABELS).map(([field, label]) => (
                  <button
                    key={field}
                    onClick={() => {
                      const store = useUpdaterStore.getState()
                      if (sortField === field) {
                        store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                      } else {
                        store.setSortField(field as any)
                        store.setSortDirection('asc')
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

      {/* Winget not available warning */}
      {hasChecked && !wingetAvailable && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.1)',
          }}
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" strokeWidth={1.8} />
          <p className="text-[12px] text-zinc-400">
            <span className="font-semibold text-red-400">winget not found</span> — Windows Package
            Manager is required. Install it from the{' '}
            <span className="text-zinc-300">Microsoft Store</span> (search "App Installer") or from
            GitHub.
          </p>
        </div>
      )}

      {/* Errors */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useUpdaterStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* Stat cards */}
      {hasChecked && wingetAvailable && apps.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard icon={Package} label="Outdated Apps" value={apps.length} variant="accent" />
          <StatCard icon={AlertTriangle} label="Major Updates" value={majorCount} variant="danger" />
          <StatCard icon={AlertTriangle} label="Minor Updates" value={minorCount} variant="default" />
          <StatCard icon={CheckCircle2} label="Patches" value={patchCount} variant="success" />
        </div>
      )}

      {/* Update progress */}
      {updating && progress && (
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
                Updating {progress.currentApp}{' '}
                <span style={{ color: '#6e6e76' }}>
                  ({progress.current} of {progress.total})
                </span>
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: '#6e6e76' }}>
              {progress.percent}%
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.percent}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
              }}
            />
          </div>
          {progress.status === 'failed' && (
            <p className="mt-2 text-[11px] text-red-400">
              Failed to update {progress.currentApp}
            </p>
          )}
        </div>
      )}

      {/* Update result banner */}
      {updateResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background:
              updateResult.failed === 0
                ? 'rgba(34,197,94,0.06)'
                : 'rgba(239,68,68,0.06)',
            border: `1px solid ${updateResult.failed === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          {updateResult.failed === 0 ? (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          ) : (
            <XCircle className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {updateResult.succeeded > 0 && (
              <span className="text-green-400">
                {updateResult.succeeded} app{updateResult.succeeded !== 1 ? 's' : ''} updated
                successfully
              </span>
            )}
            {updateResult.succeeded > 0 && updateResult.failed > 0 && <span> — </span>}
            {updateResult.failed > 0 && (
              <span className="text-red-400">
                {updateResult.failed} failed
              </span>
            )}
            {updateResult.errors.length > 0 && (
              <span style={{ color: '#6e6e76' }}>
                {' '}
                ({updateResult.errors.map((e) => e.name).join(', ')})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Selection controls + Update button */}
      {hasChecked && apps.length > 0 && !loading && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => {
              const store = useUpdaterStore.getState()
              allSelected ? store.deselectAll() : store.selectAll()
            }}
            disabled={updating}
            className="flex items-center gap-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          >
            <div
              className="flex h-4 w-4 items-center justify-center rounded"
              style={{
                background: allSelected ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                border: allSelected ? 'none' : '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {allSelected && (
                <CheckCircle2 className="h-3 w-3" style={{ color: '#1a0a00' }} strokeWidth={3} />
              )}
            </div>
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>

          {selectedCount > 0 && (
            <span className="text-[12px]" style={{ color: '#6e6e76' }}>
              {selectedCount} selected
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={handleUpdateSelected}
            disabled={selectedCount === 0 || updating}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
            style={{
              background:
                selectedCount > 0
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                  : 'rgba(255,255,255,0.05)',
              color: selectedCount > 0 ? '#052e16' : '#71717a',
              border:
                selectedCount > 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            Update Selected ({selectedCount})
          </button>
        </div>
      )}

      {/* Empty state — before first check */}
      {!hasChecked && !loading && (
        <EmptyState
          icon={RefreshCw}
          title="No update check performed"
          description="Scan your installed software to find available updates via Windows Package Manager."
          action={
            <button
              onClick={handleCheck}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#1a0a00',
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
              Check for Updates
            </button>
          }
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-400 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">Checking for updates...</p>
          <p className="text-[11px] mt-1" style={{ color: '#52525e' }}>
            This may take a moment while winget queries available updates
          </p>
        </div>
      )}

      {/* All up to date */}
      {hasChecked && !loading && apps.length === 0 && wingetAvailable && (
        <EmptyState
          icon={Sparkles}
          title="Everything is up to date!"
          description="All your installed software is running the latest version. Check back later for new updates."
        />
      )}

      {/* No results from filter/search */}
      {hasChecked && !loading && filteredApps.length === 0 && apps.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="h-10 w-10 text-zinc-600 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">No apps match your filters</p>
        </div>
      )}

      {/* App list */}
      {hasChecked && !loading && filteredApps.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-1 gap-2">
            {filteredApps.map((app) => (
              <AppRow
                key={app.id}
                app={app}
                updating={updating}
                onToggle={() => useUpdaterStore.getState().toggleAppSelected(app.id)}
                onUpdate={() => handleUpdate([app.id])}
              />
            ))}
          </div>
        </div>
      )}

      {/* Up to date apps */}
      {hasChecked && !loading && wingetAvailable && upToDate.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setShowUpToDate(!showUpToDate)}
            className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showUpToDate ? (
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            )}
            <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={1.8} />
            Up to date ({upToDate.length})
          </button>

          {showUpToDate && (
            <div className="grid grid-cols-1 gap-1.5">
              {upToDate.map((app) => (
                <UpToDateRow key={app.id} app={app} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AppRow({
  app,
  updating,
  onToggle,
  onUpdate,
}: {
  app: UpdatableApp
  updating: boolean
  onToggle: () => void
  onUpdate: () => void
}) {
  const severity = SEVERITY_STYLES[app.severity]

  return (
    <div
      className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
      style={{
        background: app.selected ? 'rgba(245,158,11,0.03)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${app.selected ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)'}`,
      }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        disabled={updating}
        className="shrink-0 disabled:opacity-40"
      >
        <div
          className="flex h-4.5 w-4.5 items-center justify-center rounded"
          style={{
            background: app.selected ? '#f59e0b' : 'rgba(255,255,255,0.06)',
            border: app.selected ? 'none' : '1px solid rgba(255,255,255,0.1)',
            width: 18,
            height: 18,
          }}
        >
          {app.selected && (
            <CheckCircle2 className="h-3 w-3" style={{ color: '#1a0a00' }} strokeWidth={3} />
          )}
        </div>
      </button>

      {/* App icon */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: severity.bg }}
      >
        <Package className="h-5 w-5" style={{ color: severity.text }} strokeWidth={1.8} />
      </div>

      {/* App info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-zinc-200 truncate">{app.name}</span>
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
            style={{
              background: severity.bg,
              border: `1px solid ${severity.border}`,
              color: severity.text,
            }}
          >
            {severity.label}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] truncate" style={{ color: '#6e6e76' }}>
          {app.id}
        </p>
      </div>

      {/* Version comparison */}
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-[12px] font-mono text-zinc-500">{app.currentVersion}</span>
        <ArrowRight className="h-3 w-3 text-zinc-600" strokeWidth={2} />
        <span className="text-[12px] font-mono font-medium" style={{ color: severity.text }}>
          {app.availableVersion}
        </span>
      </div>

      {/* Source badge */}
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{ background: 'rgba(255,255,255,0.05)', color: '#6e6e76' }}
      >
        {app.source}
      </span>

      {/* Update button */}
      <button
        onClick={onUpdate}
        disabled={updating}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-green-400 transition-all hover:bg-green-500/10 disabled:opacity-30 shrink-0"
        style={{ border: '1px solid rgba(34,197,94,0.15)' }}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
        Update
      </button>
    </div>
  )
}

function UpToDateRow({ app }: { app: UpToDateApp }) {
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-5 py-3"
      style={{
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.03)',
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(34,197,94,0.08)' }}
      >
        <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-medium text-zinc-400 truncate block">{app.name}</span>
        <span className="text-[10px] truncate block" style={{ color: '#52525e' }}>
          {app.id}
        </span>
      </div>
      <span className="text-[11px] font-mono text-zinc-600 shrink-0">{app.version}</span>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{ background: 'rgba(34,197,94,0.06)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.1)' }}
      >
        Latest
      </span>
    </div>
  )
}
