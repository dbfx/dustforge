import { useEffect, useState, useCallback, useRef } from 'react'
import {
  HardDrive,
  Sparkles,
  FileStack,
  Clock,
  Search,
  Database,
  BarChart3,
  Trash2,
  Zap,
  Shield,
  CheckCircle2,
  Wifi,
  Loader2,
  Cpu,
  Check,
  Download,
  Server
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatCard } from '@/components/shared/StatCard'
import { HealthScore } from '@/components/shared/HealthScore'
import { formatBytes, formatDate, formatNumber } from '@/lib/utils'
import { useStatsStore } from '@/stores/stats-store'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { useUpdaterStore } from '@/stores/updater-store'
import { useServiceStore } from '@/stores/service-store'
import { useStartupStore } from '@/stores/startup-store'
import type { DriveInfo, ActivityEntry, ScanResult, CleanResult } from '@shared/types'
import { CleanerType } from '@shared/enums'

type OneClickPhase = 'idle' | 'scanning' | 'cleaning' | 'done'

interface OneClickResult {
  spaceRecovered: number
  filesCleaned: number
  registryFixed: number
  networkCleaned: number
  driversRemoved: number
}

const CLEANER_SCAN_FNS: { type: CleanerType; scan: () => Promise<ScanResult[]>; clean: (ids: string[]) => Promise<CleanResult> }[] = [
  { type: CleanerType.System, scan: () => window.dustforge.systemScan(), clean: (ids) => window.dustforge.systemClean(ids) },
  { type: CleanerType.Browser, scan: () => window.dustforge.browserScan(), clean: (ids) => window.dustforge.browserClean(ids) },
  { type: CleanerType.App, scan: () => window.dustforge.appScan(), clean: (ids) => window.dustforge.appClean(ids) },
  { type: CleanerType.Gaming, scan: () => window.dustforge.gamingScan(), clean: (ids) => window.dustforge.gamingClean(ids) },
  { type: CleanerType.RecycleBin, scan: () => window.dustforge.recycleBinScan(), clean: () => window.dustforge.recycleBinClean() },
]

export function DashboardPage() {
  const stats = useStatsStore((s) => s.stats)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const historyStore = useHistoryStore()
  const scanStore = useScanStore()
  const updaterHasChecked = useUpdaterStore((s) => s.hasChecked)
  const serviceHasScanned = useServiceStore((s) => s.hasScanned)
  const startupItems = useStartupStore((s) => s.items)
  const cleanStartRef = useRef<number>(0)
  const navigate = useNavigate()
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [phase, setPhase] = useState<OneClickPhase>('idle')
  const [phaseLabel, setPhaseLabel] = useState('')
  const [result, setResult] = useState<OneClickResult | null>(null)
  const [showQuickConfirm, setShowQuickConfirm] = useState(false)
  const [showFullConfirm, setShowFullConfirm] = useState(false)
  const [stepProgress, setStepProgress] = useState({ current: 0, total: 0 })

  useEffect(() => {
    window.dustforge?.diskDrives?.()
      .then(setDrives)
      .catch((err) => console.error('Failed to load drives:', err))
  }, [])

  // Determine which tools have been used recently (past 14 days)
  const toolCoverage = (() => {
    const entries = historyStore.entries
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
    const recentEntries = entries.filter((e) => new Date(e.timestamp).getTime() > twoWeeksAgo)
    const recentTypes = new Set(recentEntries.map((e) => e.type))
    const allTypes = new Set(entries.map((e) => e.type))

    // History-based tools
    const historyTools = [
      { key: 'cleaner' as const, label: 'Cleaner', icon: Search, color: '#f59e0b' },
      { key: 'registry' as const, label: 'Registry', icon: Database, color: '#3b82f6' },
      { key: 'drivers' as const, label: 'Drivers', icon: Cpu, color: '#a855f7' }
    ]

    const historyResults = historyTools.map((t) => ({
      ...t,
      usedRecently: recentTypes.has(t.key),
      usedEver: allTypes.has(t.key)
    }))

    // Session-based tools (tracked by whether they've been run this session)
    const sessionTools = [
      { key: 'updater', label: 'Updater', icon: Download, color: '#06b6d4', active: updaterHasChecked },
      { key: 'services', label: 'Services', icon: Server, color: '#ec4899', active: serviceHasScanned },
      { key: 'startup', label: 'Startup', icon: Zap, color: '#22c55e', active: startupItems.length > 0 }
    ]

    const sessionResults = sessionTools.map((t) => ({
      key: t.key,
      label: t.label,
      icon: t.icon,
      color: t.color,
      usedRecently: t.active,
      usedEver: t.active
    }))

    return [...historyResults, ...sessionResults]
  })()

  const healthScore = (() => {
    // Health is primarily driven by tool coverage shown in the icons
    const totalTools = toolCoverage.length
    const doneTools = toolCoverage.filter((t) => t.usedRecently).length

    // Base score from tool coverage (0-60 points)
    let score = Math.round((doneTools / totalTools) * 60)

    // Drive space penalty: lose up to 20 points based on worst drive usage
    if (drives.length > 0) {
      const worstUsage = Math.max(...drives.map((d) => d.usedSpace / d.totalSize))
      if (worstUsage > 0.7) {
        score -= Math.min(20, Math.round((worstUsage - 0.7) / 0.3 * 20))
      }
    }

    // Recency penalty: lose up to 20 points as last scan ages (stale after 7 days)
    if (stats.lastScanDate) {
      const daysSinceScan = (Date.now() - new Date(stats.lastScanDate).getTime()) / (1000 * 60 * 60 * 24)
      score -= Math.min(20, Math.round(daysSinceScan * (20 / 7)))
    } else {
      score -= 10
    }

    // Base bonus for having run at least one scan ever
    if (stats.lastScanDate) score += 40

    return Math.max(0, Math.min(100, score))
  })()

  // Scan+clean file categories, respecting excluded subcategories from scan-store
  const runCleaners = useCallback(async (): Promise<{ space: number; files: number }> => {
    const excluded = scanStore.excludedSubcategories
    let totalSpace = 0
    let totalFiles = 0

    for (const { type, scan, clean } of CLEANER_SCAN_FNS) {
      try {
        setPhaseLabel(`Scanning ${type}...`)
        const results = await scan()
        // Select items from non-excluded subcategories
        const selectedIds = results
          .filter((r) => !excluded.has(r.subcategory))
          .flatMap((r) => r.items.map((i) => i.id))
        if (selectedIds.length > 0) {
          setPhaseLabel(`Cleaning ${type}...`)
          const res = await clean(selectedIds)
          totalSpace += res.totalCleaned || 0
          totalFiles += res.filesDeleted || 0
        }
      } catch {
        toast.error(`Failed to clean ${type}`)
      }
    }
    return { space: totalSpace, files: totalFiles }
  }, [scanStore.excludedSubcategories])

  // Scan+fix registry
  const runRegistry = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel('Scanning registry...')
      const entries = await window.dustforge.registryScan()
      if (!Array.isArray(entries)) return 0
      const selectedIds = entries.filter((e) => e?.selected).map((e) => e.id)
      if (selectedIds.length === 0) return 0
      setPhaseLabel('Fixing registry...')
      const res = await window.dustforge.registryFix(selectedIds)
      return res?.fixed ?? 0
    } catch {
      toast.error('Registry scan failed')
      return 0
    }
  }, [])

  // Scan+clean network
  const runNetwork = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel('Scanning network...')
      const items = await window.dustforge.networkScan()
      if (!Array.isArray(items)) return 0
      const selectedIds = items.filter((i) => i?.selected).map((i) => i.id)
      if (selectedIds.length === 0) return 0
      setPhaseLabel('Cleaning network...')
      const res = await window.dustforge.networkClean(selectedIds)
      return res?.cleaned ?? 0
    } catch {
      toast.error('Network cleanup failed')
      return 0
    }
  }, [])

  // Scan+remove stale drivers (excludes driver updates)
  const runDrivers = useCallback(async (): Promise<{ removed: number; space: number }> => {
    try {
      setPhaseLabel('Scanning drivers...')
      const scanResult = await window.dustforge.driverScan()
      const stalePackages = scanResult.packages.filter((p) => !p.isCurrent && p.selected)
      if (stalePackages.length === 0) return { removed: 0, space: 0 }
      setPhaseLabel('Removing stale drivers...')
      const cleanResult = await window.dustforge.driverClean(stalePackages.map((p) => p.publishedName))
      return { removed: cleanResult.removed, space: cleanResult.spaceRecovered }
    } catch {
      toast.error('Driver cleanup failed')
      return { removed: 0, space: 0 }
    }
  }, [])

  const handleQuickClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    setStepProgress({ current: 0, total: 2 })

    setPhase('cleaning')
    setStepProgress({ current: 1, total: 2 })
    const { space, files } = await runCleaners()
    setStepProgress({ current: 2, total: 2 })
    const regFixed = await runRegistry()

    const oneClickResult: OneClickResult = {
      spaceRecovered: space,
      filesCleaned: files,
      registryFixed: regFixed,
      networkCleaned: 0,
      driversRemoved: 0
    }

    const totalItems = files + regFixed
    if (totalItems > 0) {
      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalItems,
        totalItemsCleaned: totalItems,
        totalItemsSkipped: 0,
        totalSpaceSaved: space,
        categories: [
          ...(files > 0
            ? [{ name: 'Quick Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }]
            : []),
          ...(regFixed > 0
            ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }]
            : [])
        ],
        errorCount: 0
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
  }, [phase, runCleaners, runRegistry, historyStore, recomputeStats])

  const handleFullClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    setStepProgress({ current: 0, total: 4 })

    setPhase('cleaning')
    setStepProgress({ current: 1, total: 4 })
    const { space, files } = await runCleaners()
    setStepProgress({ current: 2, total: 4 })
    const regFixed = await runRegistry()
    setStepProgress({ current: 3, total: 4 })
    const netCleaned = await runNetwork()
    setStepProgress({ current: 4, total: 4 })
    const drivers = await runDrivers()

    const oneClickResult: OneClickResult = {
      spaceRecovered: space + drivers.space,
      filesCleaned: files,
      registryFixed: regFixed,
      networkCleaned: netCleaned,
      driversRemoved: drivers.removed
    }

    const totalItems = files + regFixed + netCleaned + drivers.removed
    if (totalItems > 0) {
      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalItems,
        totalItemsCleaned: totalItems,
        totalItemsSkipped: 0,
        totalSpaceSaved: space + drivers.space,
        categories: [
          ...(files > 0
            ? [{ name: 'Full Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }]
            : []),
          ...(regFixed > 0
            ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }]
            : []),
          ...(netCleaned > 0
            ? [{ name: 'Network', itemsFound: netCleaned, itemsCleaned: netCleaned, spaceSaved: 0 }]
            : []),
          ...(drivers.removed > 0
            ? [{ name: 'Stale Drivers', itemsFound: drivers.removed, itemsCleaned: drivers.removed, spaceSaved: drivers.space }]
            : [])
        ],
        errorCount: 0
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
  }, [phase, runCleaners, runRegistry, runNetwork, runDrivers, historyStore, recomputeStats])

  const isRunning = phase === 'scanning' || phase === 'cleaning'
  const activity = stats.recentActivity

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" description="System overview and quick actions" />

      {/* Hero row — health + stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        {/* Health Score Card */}
        <div
          className="flex flex-col items-center justify-center rounded-2xl px-6 py-6"
          style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <HealthScore score={healthScore} size="md" />
          <div className="mt-4 flex items-center gap-2">
            {toolCoverage.map((tool) => {
              const Icon = tool.icon
              return (
                <div
                  key={tool.key}
                  className="relative flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                  style={{
                    background: tool.usedRecently ? tool.color + '18' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${tool.usedRecently ? tool.color + '30' : 'rgba(255,255,255,0.04)'}`
                  }}
                  title={`${tool.label}: ${tool.usedRecently ? 'Used recently' : tool.usedEver ? 'Not used recently' : 'Never used'}`}
                >
                  <Icon
                    className="h-3.5 w-3.5"
                    style={{ color: tool.usedRecently ? tool.color : '#3a3a42' }}
                    strokeWidth={1.8}
                  />
                  {tool.usedRecently && (
                    <div
                      className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full"
                      style={{ background: '#22c55e' }}
                    >
                      <Check className="h-2 w-2 text-white" strokeWidth={3} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <StatCard
          icon={HardDrive}
          label="Space Recovered"
          value={stats.totalSpaceSaved}
          displayValue={formatBytes(stats.totalSpaceSaved)}
          variant="accent"
        />
        <StatCard
          icon={FileStack}
          label="Files Cleaned"
          value={stats.totalFilesCleaned}
          variant="success"
        />
        <StatCard
          icon={Clock}
          label="Last Scan"
          value={0}
          displayValue={stats.lastScanDate ? formatDate(stats.lastScanDate) : 'Never'}
        />
      </div>

      {/* One-click actions row */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        {/* Quick Clean */}
        <button
          onClick={() => setShowQuickConfirm(true)}
          disabled={isRunning}
          className="group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60"
          style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
          onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.borderColor = 'rgba(245,158,11,0.2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >
            <Sparkles className="h-5 w-5" style={{ color: '#1a0a00' }} strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-zinc-200">Quick Clean</p>
            <p className="text-[12px]" style={{ color: '#52525e' }}>
              Clean junk files + fix registry issues
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: '#3f3f46' }}>
              Respects your category selections from the Cleaner page
            </p>
          </div>
        </button>

        {/* Full Clean */}
        <button
          onClick={() => setShowFullConfirm(true)}
          disabled={isRunning}
          className="group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60"
          style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
          onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}
          >
            <Shield className="h-5 w-5 text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-zinc-200">Full Clean, Optimize & Protect</p>
            <p className="text-[12px]" style={{ color: '#52525e' }}>
              Junk files + registry + network + stale drivers
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: '#3f3f46' }}>
              Everything except Debloater, Startup, and Driver Updates
            </p>
          </div>
        </button>
      </div>

      {/* Progress / result banner */}
      {isRunning && (
        <div
          className="mb-6 rounded-2xl px-5 py-4"
          style={{ background: '#16161a', border: '1px solid rgba(245,158,11,0.15)' }}
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} />
            <span className="flex-1 text-[13px] text-zinc-400">{phaseLabel || 'Working...'}</span>
            {stepProgress.total > 0 && (
              <span className="text-[11px] font-mono" style={{ color: '#52525e' }}>
                {stepProgress.current}/{stepProgress.total}
              </span>
            )}
          </div>
          {stepProgress.total > 0 && (
            <div className="mt-2.5 h-[3px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(stepProgress.current / stepProgress.total) * 100}%`, background: '#f59e0b' }}
              />
            </div>
          )}
        </div>
      )}

      {phase === 'done' && result && (
        <div
          className="mb-6 rounded-2xl p-4"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">Cleanup complete!</p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                {result.spaceRecovered > 0 && (
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    {formatBytes(result.spaceRecovered)} recovered
                  </p>
                )}
                {result.filesCleaned > 0 && (
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    {formatNumber(result.filesCleaned)} files cleaned
                  </p>
                )}
                {result.registryFixed > 0 && (
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    {result.registryFixed} registry entries fixed
                  </p>
                )}
                {result.networkCleaned > 0 && (
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    {result.networkCleaned} network items cleaned
                  </p>
                )}
                {result.driversRemoved > 0 && (
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    {result.driversRemoved} stale drivers removed
                  </p>
                )}
                {result.spaceRecovered === 0 && result.filesCleaned === 0 && result.registryFixed === 0 && result.networkCleaned === 0 && result.driversRemoved === 0 && (
                  <p className="text-[12px]" style={{ color: '#6e6e76' }}>
                    System is already clean — nothing to do
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Middle row — nav shortcuts + activity */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        {/* Quick Navigation */}
        <div
          className="rounded-2xl p-5"
          style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
            Quick Actions
          </h3>
          <div className="grid grid-cols-4 gap-2.5">
            <QuickAction icon={Search} label="Cleaner" onClick={() => navigate('/cleaner')} />
            <QuickAction icon={Database} label="Registry" onClick={() => navigate('/registry')} />
            <QuickAction icon={Wifi} label="Network" onClick={() => navigate('/network')} />
            <QuickAction icon={BarChart3} label="Disk Map" onClick={() => navigate('/disk')} />
          </div>
        </div>

        {/* Recent Activity */}
        <div
          className="rounded-2xl p-5"
          style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
            Recent Activity
          </h3>
          <div className="space-y-1">
            {activity.slice(0, 4).map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
            {activity.length === 0 && (
              <p className="py-4 text-center text-[13px]" style={{ color: '#4e4e56' }}>
                No recent activity
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Storage Overview */}
      <div
        className="rounded-2xl p-5"
        style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <h3 className="mb-5 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
          Storage Overview
        </h3>
        <div className="space-y-5">
          {drives.length === 0 && (
            <p className="py-4 text-center text-[13px]" style={{ color: '#4e4e56' }}>
              Unable to load drive information
            </p>
          )}
          {drives.map((drive) => (
            <DriveBar key={drive.letter} drive={drive} />
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={showQuickConfirm}
        onConfirm={() => { setShowQuickConfirm(false); handleQuickClean() }}
        onCancel={() => setShowQuickConfirm(false)}
        title="Quick Clean"
        description="This will scan and clean junk files across all non-excluded categories and fix selected registry issues. Your category exclusions from the Cleaner page are respected."
        confirmLabel="Start Quick Clean"
        variant="warning"
      />

      <ConfirmDialog
        open={showFullConfirm}
        onConfirm={() => { setShowFullConfirm(false); handleFullClean() }}
        onCancel={() => setShowFullConfirm(false)}
        title="Full Clean, Optimize & Protect"
        description="This will clean junk files, fix registry issues, flush DNS and ARP caches, and remove stale driver packages. Network caches rebuild automatically, but this is a broad operation that touches multiple system areas."
        confirmLabel="Start Full Clean"
        variant="warning"
      />
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Search
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2.5 rounded-xl py-4 text-zinc-500 transition-all"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
        e.currentTarget.style.color = '#d4d4d8'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'
        e.currentTarget.style.color = ''
      }}
    >
      <Icon className="h-5 w-5" strokeWidth={1.6} />
      <span className="text-[12px] font-medium">{label}</span>
    </button>
  )
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const iconMap: Record<string, typeof Trash2> = { clean: Trash2, registry: Database, startup: Zap, scan: Search, drivers: Cpu, network: Wifi }
  const colorMap: Record<string, string> = { clean: '#f59e0b', registry: '#3b82f6', startup: '#22c55e', scan: '#6e6e76', drivers: '#a855f7', network: '#22c55e' }
  const Icon = iconMap[entry.type] || Search

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: colorMap[entry.type] }} strokeWidth={1.8} />
      <span className="flex-1 truncate text-[13px] text-zinc-400">{entry.message}</span>
      <span className="shrink-0 text-[11px]" style={{ color: '#4e4e56' }}>{formatDate(entry.timestamp)}</span>
    </div>
  )
}

function DriveBar({ drive }: { drive: DriveInfo }) {
  const usedPercent = (drive.usedSpace / drive.totalSize) * 100
  const barColor = usedPercent > 90 ? '#ef4444' : usedPercent > 75 ? '#f59e0b' : '#22c55e'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4" style={{ color: '#52525e' }} strokeWidth={1.6} />
          <span className="text-[13px] font-medium text-zinc-300">
            {drive.letter}: {drive.label}
          </span>
        </div>
        <span className="font-mono text-[11px]" style={{ color: '#6e6e76' }}>
          {formatBytes(drive.usedSpace)} / {formatBytes(drive.totalSize)}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${usedPercent}%`, background: barColor }}
        />
      </div>
    </div>
  )
}
