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
  Loader2
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { HealthScore } from '@/components/shared/HealthScore'
import { formatBytes, formatDate, formatNumber } from '@/lib/utils'
import { useStatsStore } from '@/stores/stats-store'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import type { DriveInfo, ActivityEntry, ScanResult, CleanResult } from '@shared/types'
import { CleanerType } from '@shared/enums'

type OneClickPhase = 'idle' | 'scanning' | 'cleaning' | 'done'

interface OneClickResult {
  spaceRecovered: number
  filesCleaned: number
  registryFixed: number
  networkCleaned: number
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
  const cleanStartRef = useRef<number>(0)
  const navigate = useNavigate()
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [phase, setPhase] = useState<OneClickPhase>('idle')
  const [phaseLabel, setPhaseLabel] = useState('')
  const [result, setResult] = useState<OneClickResult | null>(null)

  useEffect(() => {
    window.dustforge?.diskDrives?.()
      .then(setDrives)
      .catch((err) => console.error('Failed to load drives:', err))
  }, [])

  const healthScore = (() => {
    let score = 100

    // Penalize if no scans have ever been run
    if (!stats.lastScanDate) return 50

    // Recency penalty: lose up to 30 points as scan ages (stale after 7 days)
    const daysSinceScan = (Date.now() - new Date(stats.lastScanDate).getTime()) / (1000 * 60 * 60 * 24)
    score -= Math.min(30, Math.round(daysSinceScan * (30 / 7)))

    // Drive space penalty: lose up to 30 points based on worst drive usage
    if (drives.length > 0) {
      const worstUsage = Math.max(...drives.map((d) => d.usedSpace / d.totalSize))
      // Ramp up penalty past 70% usage
      if (worstUsage > 0.7) {
        score -= Math.min(30, Math.round((worstUsage - 0.7) / 0.3 * 30))
      }
    }

    // Activity bonus: up to 10 points for recent cleaning activity (past 7 days)
    const recentCleans = stats.recentActivity.filter((a) => {
      const age = Date.now() - new Date(a.timestamp).getTime()
      return a.type === 'clean' && age < 7 * 24 * 60 * 60 * 1000
    }).length
    score += Math.min(10, recentCleans * 3)

    // Scan count bonus: up to 10 points for regular usage
    score += Math.min(10, stats.totalScans * 2)

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
      } catch { /* skip category */ }
    }
    return { space: totalSpace, files: totalFiles }
  }, [scanStore.excludedSubcategories])

  // Scan+fix registry
  const runRegistry = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel('Scanning registry...')
      const entries = await window.dustforge.registryScan()
      const selectedIds = entries.filter((e) => e.selected).map((e) => e.id)
      if (selectedIds.length === 0) return 0
      setPhaseLabel('Fixing registry...')
      const res = await window.dustforge.registryFix(selectedIds)
      return res.fixed
    } catch {
      return 0
    }
  }, [])

  // Scan+clean network
  const runNetwork = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel('Scanning network...')
      const items = await window.dustforge.networkScan()
      const selectedIds = items.filter((i) => i.selected).map((i) => i.id)
      if (selectedIds.length === 0) return 0
      setPhaseLabel('Cleaning network...')
      const res = await window.dustforge.networkClean(selectedIds)
      return res.cleaned
    } catch {
      return 0
    }
  }, [])

  const handleQuickClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)

    setPhase('cleaning')
    const { space, files } = await runCleaners()
    const regFixed = await runRegistry()

    const oneClickResult: OneClickResult = {
      spaceRecovered: space,
      filesCleaned: files,
      registryFixed: regFixed,
      networkCleaned: 0
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

    setPhase('cleaning')
    const { space, files } = await runCleaners()
    const regFixed = await runRegistry()
    const netCleaned = await runNetwork()

    const oneClickResult: OneClickResult = {
      spaceRecovered: space,
      filesCleaned: files,
      registryFixed: regFixed,
      networkCleaned: netCleaned
    }

    const totalItems = files + regFixed + netCleaned
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
            ? [{ name: 'Full Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }]
            : []),
          ...(regFixed > 0
            ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }]
            : []),
          ...(netCleaned > 0
            ? [{ name: 'Network', itemsFound: netCleaned, itemsCleaned: netCleaned, spaceSaved: 0 }]
            : [])
        ],
        errorCount: 0
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
  }, [phase, runCleaners, runRegistry, runNetwork, historyStore, recomputeStats])

  const isRunning = phase === 'scanning' || phase === 'cleaning'
  const activity = stats.recentActivity

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" description="System overview and quick actions" />

      {/* Hero row — health + stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        {/* Health Score Card */}
        <div
          className="flex flex-col items-center justify-center rounded-2xl px-6 py-8"
          style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <HealthScore score={healthScore} size="md" />
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
          onClick={handleQuickClean}
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
          onClick={handleFullClean}
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
              Junk files + registry + network cleanup
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: '#3f3f46' }}>
              Everything except Debloater and Startup
            </p>
          </div>
        </button>
      </div>

      {/* Progress / result banner */}
      {isRunning && (
        <div
          className="mb-6 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: '#16161a', border: '1px solid rgba(245,158,11,0.15)' }}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} />
          <span className="text-[13px] text-zinc-400">{phaseLabel || 'Working...'}</span>
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
                {result.spaceRecovered === 0 && result.filesCleaned === 0 && result.registryFixed === 0 && result.networkCleaned === 0 && (
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
  const iconMap = { clean: Trash2, registry: Database, startup: Zap, scan: Search }
  const colorMap = { clean: '#f59e0b', registry: '#3b82f6', startup: '#22c55e', scan: '#6e6e76' }
  const Icon = iconMap[entry.type]

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
