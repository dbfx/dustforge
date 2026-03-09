import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Server,
  Search,
  Shield,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Circle,
  Link2
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useServiceStore } from '@/stores/service-store'
import { useHistoryStore } from '@/stores/history-store'
import type { ServiceScanProgress, WindowsService, ServiceCategory } from '@shared/types'

const SAFETY_COLORS = {
  safe: { dot: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.20)' },
  caution: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
  unsafe: { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.20)' }
} as const

const STATUS_COLORS: Record<string, string> = {
  Running: '#22c55e',
  Stopped: '#6e6e76',
  StartPending: '#f59e0b',
  StopPending: '#f59e0b',
  Paused: '#f59e0b',
  Unknown: '#6e6e76'
}

const CATEGORY_LABELS: Record<ServiceCategory | 'all', string> = {
  all: 'All Categories',
  telemetry: 'Telemetry',
  xbox: 'Xbox',
  print: 'Print',
  fax: 'Fax',
  media: 'Media',
  network: 'Network',
  bluetooth: 'Bluetooth',
  remote: 'Remote',
  'hyper-v': 'Hyper-V',
  developer: 'Developer',
  misc: 'Misc',
  core: 'Core',
  security: 'Security',
  unknown: 'Other'
}

export function ServiceManagerPage() {
  const services = useServiceStore((s) => s.services)
  const scanning = useServiceStore((s) => s.scanning)
  const applying = useServiceStore((s) => s.applying)
  const scanProgress = useServiceStore((s) => s.scanProgress)
  const applyResult = useServiceStore((s) => s.applyResult)
  const error = useServiceStore((s) => s.error)
  const hasScanned = useServiceStore((s) => s.hasScanned)
  const searchQuery = useServiceStore((s) => s.searchQuery)
  const safetyFilter = useServiceStore((s) => s.safetyFilter)
  const categoryFilter = useServiceStore((s) => s.categoryFilter)
  const statusFilter = useServiceStore((s) => s.statusFilter)

  const [showConfirm, setShowConfirm] = useState(false)
  const isBusy = scanning || applying

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.dustforge?.onServiceProgress?.((data: ServiceScanProgress) => {
      useServiceStore.getState().setScanProgress(data)
    })
    return () => { cleanup?.() }
  }, [])

  // ─── Scan ──────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    const store = useServiceStore.getState()
    store.setScanning(true)
    store.setServices([])
    store.setApplyResult(null)
    store.setError(null)
    store.setScanProgress(null)

    try {
      const result = await window.dustforge.serviceScan()
      const s = useServiceStore.getState()
      s.setServices(result.services)
      s.setHasScanned(true)
    } catch (err) {
      useServiceStore
        .getState()
        .setError(err instanceof Error ? err.message : 'Failed to scan services')
    } finally {
      useServiceStore.getState().setScanning(false)
      useServiceStore.getState().setScanProgress(null)
    }
  }, [])

  // Auto-scan on first visit
  useEffect(() => {
    if (!hasScanned && !scanning) handleScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Apply ─────────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    setShowConfirm(false)
    const store = useServiceStore.getState()
    store.setApplying(true)
    store.setApplyResult(null)
    store.setError(null)

    const startTime = Date.now()
    const selected = store.services.filter((s) => s.selected)
    const changes = selected.map((s) => ({
      name: s.name,
      targetStartType: 'Disabled'
    }))

    try {
      const result = await window.dustforge.serviceApply(changes)
      useServiceStore.getState().setApplyResult(result)

      // Re-scan to refresh state
      const scanResult = await window.dustforge.serviceScan()
      useServiceStore.getState().setServices(scanResult.services)

      // Log to history
      const byCat: Record<string, { found: number; disabled: number }> = {}
      for (const svc of selected) {
        const cat = svc.category
        if (!byCat[cat]) byCat[cat] = { found: 0, disabled: 0 }
        byCat[cat].found++
        if (!result.errors.some(e => e.name === svc.name)) byCat[cat].disabled++
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'services',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: selected.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: Object.entries(byCat).map(([name, d]) => ({
          name, itemsFound: d.found, itemsCleaned: d.disabled, spaceSaved: 0
        })),
        errorCount: result.failed
      })
    } catch (err) {
      useServiceStore
        .getState()
        .setError(err instanceof Error ? err.message : 'Failed to apply changes')
    } finally {
      useServiceStore.getState().setApplying(false)
    }
  }, [])

  const handleSelectRecommended = useCallback(() => {
    useServiceStore.getState().selectRecommended()
  }, [])

  // ─── Filtering ─────────────────────────────────────────────
  const filteredServices = useMemo(() => {
    let result = services

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      )
    }

    if (safetyFilter !== 'all') {
      result = result.filter((s) => s.safety === safetyFilter)
    }

    if (categoryFilter !== 'all') {
      result = result.filter((s) => s.category === categoryFilter)
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'running') result = result.filter((s) => s.status === 'Running')
      else if (statusFilter === 'stopped') result = result.filter((s) => s.status === 'Stopped')
      else if (statusFilter === 'disabled') result = result.filter((s) => s.startType === 'Disabled')
    }

    return result
  }, [services, searchQuery, safetyFilter, categoryFilter, statusFilter])

  const selectedCount = services.filter((s) => s.selected).length
  const totalSafeToDisable = services.filter(
    (s) => s.safety === 'safe' && s.startType !== 'Disabled'
  ).length
  const runningCount = services.filter((s) => s.status === 'Running').length
  const disabledCount = services.filter((s) => s.startType === 'Disabled').length

  // ─── Categories present in scan results ────────────────────
  const presentCategories = useMemo(() => {
    const cats = new Set<ServiceCategory>()
    for (const s of services) cats.add(s.category)
    return cats
  }, [services])

  // ─── Group by safety level ────────────────────────────────
  const safetyGroups = useMemo(() => {
    const groups: { key: 'safe' | 'caution' | 'unsafe'; label: string; services: typeof filteredServices }[] = [
      { key: 'safe', label: 'Safe to Disable', services: filteredServices.filter((s) => s.safety === 'safe') },
      { key: 'caution', label: 'Use Caution', services: filteredServices.filter((s) => s.safety === 'caution') },
      { key: 'unsafe', label: 'System Critical', services: filteredServices.filter((s) => s.safety === 'unsafe') }
    ]
    return groups.filter((g) => g.services.length > 0)
  }, [filteredServices])

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title="Services Manager"
        description="View, manage, and disable unnecessary Windows services to improve performance"
      />

      {/* ── Action bar ───────────────────────────────────────── */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={handleScan}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
          style={{
            background: isBusy ? '#27272a' : '#f59e0b',
            opacity: isBusy ? 0.5 : 1
          }}
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          )}
          {scanning ? 'Scanning...' : 'Scan Services'}
        </button>

        {hasScanned && (
          <>
            <button
              onClick={handleSelectRecommended}
              disabled={isBusy || totalSafeToDisable === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-all"
              style={{
                background: 'rgba(34,197,94,0.10)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.20)',
                opacity: isBusy || totalSafeToDisable === 0 ? 0.5 : 1
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              Apply Recommended ({totalSafeToDisable})
            </button>

            <button
              onClick={() => setShowConfirm(true)}
              disabled={isBusy || selectedCount === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
              style={{
                background: selectedCount > 0 && !isBusy ? '#dc2626' : '#27272a',
                opacity: isBusy || selectedCount === 0 ? 0.5 : 1
              }}
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" strokeWidth={2} />
              )}
              {applying ? 'Applying...' : `Disable Selected (${selectedCount})`}
            </button>
          </>
        )}
      </div>

      {/* ── Info banner ──────────────────────────────────────── */}
      {hasScanned && !applyResult && (
        <div
          className="mb-5 flex items-start gap-3 rounded-xl px-4 py-3"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.12)' }}
        >
          <Shield className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} strokeWidth={2} />
          <div className="text-[12.5px] leading-relaxed" style={{ color: '#a1a1aa' }}>
            <span className="font-medium" style={{ color: '#22c55e' }}>Green</span> = safe to disable,{' '}
            <span className="font-medium" style={{ color: '#f59e0b' }}>Amber</span> = may affect functionality,{' '}
            <span className="font-medium" style={{ color: '#ef4444' }}>Red</span> = system-critical.
            Use &quot;Apply Recommended&quot; for a safe one-click preset.
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────── */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useServiceStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* ── Scan progress ────────────────────────────────────── */}
      {scanning && scanProgress && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-medium" style={{ color: '#a1a1aa' }}>
              {scanProgress.phase === 'enumerating' ? 'Enumerating services...' : 'Classifying services...'}
            </span>
            {scanProgress.total > 0 && (
              <span className="text-[12px]" style={{ color: '#6e6e76' }}>
                {scanProgress.current} / {scanProgress.total}
              </span>
            )}
          </div>
          {scanProgress.total > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: '#27272a' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  background: '#f59e0b',
                  width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%`
                }}
              />
            </div>
          )}
          <div className="mt-1.5 truncate text-[11.5px]" style={{ color: '#52525b' }}>
            {scanProgress.currentService}
          </div>
        </div>
      )}

      {/* ── Apply result ─────────────────────────────────────── */}
      {applyResult && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.06)' : 'rgba(34,197,94,0.06)',
            border: `1px solid ${applyResult.failed > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)'}`
          }}
        >
          <div className="flex items-center gap-2">
            {applyResult.failed > 0 ? (
              <AlertTriangle className="h-4 w-4" style={{ color: '#f59e0b' }} />
            ) : (
              <CheckCircle2 className="h-4 w-4" style={{ color: '#22c55e' }} />
            )}
            <span className="text-[13px] font-medium text-white">
              {applyResult.succeeded} service{applyResult.succeeded !== 1 ? 's' : ''} disabled
              {applyResult.failed > 0 && `, ${applyResult.failed} failed`}
            </span>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {applyResult.errors.map((e, i) => (
                <div key={i} className="text-[11.5px]" style={{ color: '#a1a1aa' }}>
                  {e.displayName || e.name}: {e.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────── */}
      {!hasScanned && !scanning && (
        <EmptyState
          icon={Server}
          title="Scan Windows Services"
          description="Enumerate all services and identify which ones can be safely disabled to improve performance."
          action={
            <button
              onClick={handleScan}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#1a0a00' }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              Scan Services
            </button>
          }
        />
      )}

      {/* ── Stats row ────────────────────────────────────────── */}
      {hasScanned && !scanning && (
        <>
          <div className="mb-5 grid grid-cols-4 gap-3">
            <StatCard label="Total" value={services.length} color="#a1a1aa" />
            <StatCard label="Running" value={runningCount} color="#22c55e" />
            <StatCard label="Disabled" value={disabledCount} color="#6e6e76" />
            <StatCard label="Safe to Disable" value={totalSafeToDisable} color="#f59e0b" />
          </div>

          {/* ── Filter bar ─────────────────────────────────────── */}
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <Search className="h-4 w-4 shrink-0" style={{ color: '#52525b' }} strokeWidth={1.8} />
              <input
                type="text"
                placeholder="Search services..."
                value={searchQuery}
                onChange={(e) => useServiceStore.getState().setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-[13px] text-white placeholder-zinc-600 outline-none"
              />
            </div>

            <FilterDropdown
              value={safetyFilter}
              options={[
                { value: 'all', label: 'All Safety' },
                { value: 'safe', label: 'Safe' },
                { value: 'caution', label: 'Caution' },
                { value: 'unsafe', label: 'Unsafe' }
              ]}
              onChange={(v) => useServiceStore.getState().setSafetyFilter(v as any)}
            />

            <FilterDropdown
              value={categoryFilter}
              options={[
                { value: 'all', label: 'All Categories' },
                ...Array.from(presentCategories)
                  .sort()
                  .map((c) => ({ value: c, label: CATEGORY_LABELS[c] || c }))
              ]}
              onChange={(v) => useServiceStore.getState().setCategoryFilter(v as any)}
            />

            <FilterDropdown
              value={statusFilter}
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'running', label: 'Running' },
                { value: 'stopped', label: 'Stopped' },
                { value: 'disabled', label: 'Disabled' }
              ]}
              onChange={(v) => useServiceStore.getState().setStatusFilter(v as any)}
            />
          </div>

          {/* ── Service list (grouped by safety) ────────────────── */}
          {filteredServices.length === 0 ? (
            <div
              className="rounded-xl py-12 text-center text-[13px]"
              style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.06)', color: '#52525b' }}
            >
              No services match your filters
            </div>
          ) : (
            <div className="space-y-3">
              {safetyGroups.map((group) => (
                <SafetyGroup key={group.key} safetyKey={group.key} label={group.label} services={group.services} />
              ))}
            </div>
          )}

          <div className="mt-2 text-right text-[11.5px]" style={{ color: '#52525b' }}>
            Showing {filteredServices.length} of {services.length} services
          </div>
        </>
      )}

      {/* ── Confirm dialog ───────────────────────────────────── */}
      <ConfirmDialog
        open={showConfirm}
        title="Disable Selected Services"
        description={`This will disable ${selectedCount} service${selectedCount !== 1 ? 's' : ''} and stop any that are currently running. This requires administrator privileges.`}
        confirmLabel="Disable Services"
        variant="danger"
        onConfirm={handleApply}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────

function SafetyGroup({
  safetyKey,
  label,
  services
}: {
  safetyKey: 'safe' | 'caution' | 'unsafe'
  label: string
  services: WindowsService[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const colors = SAFETY_COLORS[safetyKey]
  const selectedInGroup = services.filter((s) => s.selected).length
  const alreadyDisabled = services.filter((s) => s.startType === 'Disabled').length

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: '#18181b', border: `1px solid ${colors.border}` }}
    >
      {/* Group header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: colors.bg }}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: colors.dot }} strokeWidth={2} />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" style={{ color: colors.dot }} strokeWidth={2} />
        )}
        <Circle className="h-2.5 w-2.5 shrink-0" fill={colors.dot} stroke="none" />
        <span className="text-[13px] font-semibold" style={{ color: colors.dot }}>
          {label}
        </span>
        <span className="text-[12px]" style={{ color: '#6e6e76' }}>
          {services.length} service{services.length !== 1 ? 's' : ''}
          {alreadyDisabled > 0 && ` · ${alreadyDisabled} already disabled`}
          {selectedInGroup > 0 && (
            <span style={{ color: colors.dot }}> · {selectedInGroup} selected</span>
          )}
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Column header */}
          <div
            className="grid items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{
              gridTemplateColumns: '32px 1fr 120px 100px 60px',
              color: '#52525b',
              borderTop: `1px solid ${colors.border}`,
              borderBottom: '1px solid rgba(255,255,255,0.04)'
            }}
          >
            <span />
            <span>Service</span>
            <span>Startup Type</span>
            <span>Status</span>
            <span className="text-center">Deps</span>
          </div>

          {/* Rows */}
          <div className="max-h-[360px] overflow-y-auto">
            {services.map((svc) => (
              <ServiceRow key={svc.name} service={svc} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ServiceRow({ service: svc }: { service: WindowsService }) {
  const isUnsafe = svc.safety === 'unsafe'
  const colors = SAFETY_COLORS[svc.safety]

  return (
    <button
      onClick={() => !isUnsafe && useServiceStore.getState().toggleService(svc.name)}
      className="grid w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
      style={{
        gridTemplateColumns: '32px 1fr 120px 100px 60px',
        background: svc.selected ? colors.bg : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        cursor: isUnsafe ? 'default' : 'pointer'
      }}
    >
      {/* Checkbox */}
      <div className="flex justify-center">
        <div
          className="flex h-[18px] w-[18px] items-center justify-center rounded"
          style={{
            border: `1.5px solid ${svc.selected ? colors.dot : isUnsafe ? '#3f3f46' : '#52525b'}`,
            background: svc.selected ? colors.dot : 'transparent',
            opacity: isUnsafe ? 0.4 : 1
          }}
        >
          {svc.selected && <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>
      </div>

      {/* Name + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white">{svc.displayName}</span>
          {isUnsafe && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              CRITICAL
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px]" style={{ color: '#6e6e76' }}>
          {svc.description || svc.name}
        </div>
      </div>

      {/* Startup type */}
      <div>
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            background:
              svc.startType === 'Disabled'
                ? 'rgba(239,68,68,0.10)'
                : svc.startType === 'Automatic' || svc.startType === 'AutomaticDelayed'
                  ? 'rgba(59,130,246,0.10)'
                  : 'rgba(113,113,122,0.15)',
            color:
              svc.startType === 'Disabled'
                ? '#ef4444'
                : svc.startType === 'Automatic' || svc.startType === 'AutomaticDelayed'
                  ? '#60a5fa'
                  : '#a1a1aa'
          }}
        >
          {svc.startType === 'AutomaticDelayed' ? 'Auto (Delayed)' : svc.startType}
        </span>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <div
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: STATUS_COLORS[svc.status] || '#6e6e76' }}
        />
        <span className="text-[12px]" style={{ color: STATUS_COLORS[svc.status] || '#6e6e76' }}>
          {svc.status}
        </span>
      </div>

      {/* Dependencies count */}
      <div className="flex items-center justify-center gap-1">
        {svc.dependents.length > 0 && (
          <span
            className="flex items-center gap-0.5 text-[11px]"
            style={{ color: '#6e6e76' }}
            title={`${svc.dependents.length} service(s) depend on this`}
          >
            <Link2 className="h-3 w-3" strokeWidth={1.8} />
            {svc.dependents.length}
          </span>
        )}
      </div>
    </button>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#52525b' }}>
        {label}
      </div>
      <div className="mt-1 text-[22px] font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

function FilterDropdown({
  value,
  options,
  onChange
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg py-2 pl-3 pr-8 text-[12.5px] font-medium text-white outline-none"
        style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
        style={{ color: '#52525b' }}
        strokeWidth={2}
      />
    </div>
  )
}
