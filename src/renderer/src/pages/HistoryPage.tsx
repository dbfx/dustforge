import { useEffect, useState, useMemo } from 'react'
import {
  History, Sparkles, Database, PackageMinus, Trash2, ChevronDown,
  TrendingUp, Calendar, HardDrive, BarChart3, Clock, AlertCircle, Wifi, Cpu
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useHistoryStore } from '@/stores/history-store'
import { formatBytes } from '@/lib/utils'
import type { ScanHistoryEntry } from '@shared/types'

const typeConfig = {
  cleaner: { label: 'System Clean', icon: Sparkles, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  registry: { label: 'Registry Fix', icon: Database, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  debloater: { label: 'Debloater', icon: PackageMinus, color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
  network: { label: 'Network Cleanup', icon: Wifi, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  drivers: { label: 'Driver Cleanup', icon: Cpu, color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' }
} as const

const PIE_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#6366f1']

type ViewMode = 'overview' | 'timeline'

export function HistoryPage() {
  const { entries, loaded, load, clear } = useHistoryStore()
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('overview')
  const [typeFilter, setTypeFilter] = useState<'all' | ScanHistoryEntry['type']>('all')

  useEffect(() => { load() }, [])

  const filtered = useMemo(() =>
    typeFilter === 'all' ? entries : entries.filter((e) => e.type === typeFilter),
    [entries, typeFilter]
  )

  // --- Aggregated stats ---
  const stats = useMemo(() => {
    const totalSpace = entries.reduce((s, e) => s + e.totalSpaceSaved, 0)
    const totalItems = entries.reduce((s, e) => s + e.totalItemsCleaned, 0)
    const totalErrors = entries.reduce((s, e) => s + e.errorCount, 0)
    const avgDuration = entries.length > 0
      ? entries.reduce((s, e) => s + e.duration, 0) / entries.length
      : 0
    return { totalSpace, totalItems, totalErrors, avgDuration, totalScans: entries.length }
  }, [entries])

  // --- Chart data: space saved over time (last 30 entries, reversed for chronological) ---
  const timelineData = useMemo(() => {
    const recent = filtered.slice(0, 30).reverse()
    return recent.map((e) => ({
      date: new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      space: e.totalSpaceSaved,
      items: e.totalItemsCleaned,
      type: e.type
    }))
  }, [filtered])

  // --- Chart data: breakdown by scan type ---
  const typeBreakdown = useMemo(() => {
    const byType: Record<string, { count: number; space: number; items: number }> = {}
    for (const e of entries) {
      const label = typeConfig[e.type].label
      if (!byType[label]) byType[label] = { count: 0, space: 0, items: 0 }
      byType[label].count++
      byType[label].space += e.totalSpaceSaved
      byType[label].items += e.totalItemsCleaned
    }
    return Object.entries(byType).map(([name, d]) => ({ name, ...d }))
  }, [entries])

  // --- Chart data: category breakdown across all scans ---
  const categoryBreakdown = useMemo(() => {
    const byCategory: Record<string, { items: number; space: number }> = {}
    for (const e of entries) {
      for (const c of e.categories) {
        if (!byCategory[c.name]) byCategory[c.name] = { items: 0, space: 0 }
        byCategory[c.name].items += c.itemsCleaned
        byCategory[c.name].space += c.spaceSaved
      }
    }
    return Object.entries(byCategory)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.space - a.space || b.items - a.items)
      .slice(0, 8)
  }, [entries])

  // --- Weekly trend data ---
  const weeklyData = useMemo(() => {
    const weeks: Record<string, { space: number; items: number; count: number }> = {}
    for (const e of entries) {
      const d = new Date(e.timestamp)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (!weeks[key]) weeks[key] = { space: 0, items: 0, count: 0 }
      weeks[key].space += e.totalSpaceSaved
      weeks[key].items += e.totalItemsCleaned
      weeks[key].count++
    }
    return Object.entries(weeks)
      .slice(0, 12)
      .reverse()
      .map(([week, d]) => ({ week, ...d }))
  }, [entries])

  if (!loaded) return null

  if (entries.length === 0) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Scan History" description="View detailed results from past scans and cleanups" />
        <EmptyState
          icon={History}
          title="No history yet"
          description="Run a scan from the Cleaner, Registry, or Debloater pages. Results will appear here."
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Scan History"
        description="View detailed results from past scans and cleanups"
        action={
          <div className="flex items-center gap-2.5">
            {/* View mode toggle */}
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => setViewMode('overview')}
                className="px-4 py-2 text-[12px] font-medium transition-colors"
                style={{
                  background: viewMode === 'overview' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                  color: viewMode === 'overview' ? '#f59e0b' : '#6e6e76'
                }}
              >
                Overview
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className="px-4 py-2 text-[12px] font-medium transition-colors"
                style={{
                  background: viewMode === 'timeline' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                  color: viewMode === 'timeline' ? '#f59e0b' : '#6e6e76'
                }}
              >
                Timeline
              </button>
            </div>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-500 transition-all hover:text-zinc-300"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              Clear
            </button>
          </div>
        }
      />

      {viewMode === 'overview' ? (
        <OverviewView
          stats={stats}
          timelineData={timelineData}
          typeBreakdown={typeBreakdown}
          categoryBreakdown={categoryBreakdown}
          weeklyData={weeklyData}
          entries={entries}
        />
      ) : (
        <TimelineView
          entries={filtered}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          expandedEntry={expandedEntry}
          setExpandedEntry={setExpandedEntry}
        />
      )}

      <ConfirmDialog
        open={showClearConfirm}
        onConfirm={() => { clear(); setShowClearConfirm(false) }}
        onCancel={() => setShowClearConfirm(false)}
        title="Clear Scan History"
        description="This will permanently delete all scan history entries. This action cannot be undone."
        confirmLabel="Clear All"
        variant="danger"
      />
    </div>
  )
}

// ============ Overview View ============

function OverviewView({
  stats,
  timelineData,
  typeBreakdown,
  categoryBreakdown,
  weeklyData,
  entries
}: {
  stats: { totalSpace: number; totalItems: number; totalErrors: number; avgDuration: number; totalScans: number }
  timelineData: { date: string; space: number; items: number; type: string }[]
  typeBreakdown: { name: string; count: number; space: number; items: number }[]
  categoryBreakdown: { name: string; items: number; space: number }[]
  weeklyData: { week: string; space: number; items: number; count: number }[]
  entries: ScanHistoryEntry[]
}) {
  return (
    <>
      {/* Summary stat cards */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        <MiniStat icon={BarChart3} label="Total Scans" value={stats.totalScans.toString()} color="#f59e0b" />
        <MiniStat icon={HardDrive} label="Space Recovered" value={formatBytes(stats.totalSpace)} color="#22c55e" />
        <MiniStat icon={TrendingUp} label="Items Processed" value={stats.totalItems.toLocaleString()} color="#3b82f6" />
        <MiniStat icon={Clock} label="Avg Duration" value={formatDuration(stats.avgDuration)} color="#a855f7" />
      </div>

      {/* Charts row 1 — Area chart + Pie chart */}
      <div className="mb-5 grid grid-cols-3 gap-4">
        {/* Space saved over time */}
        <div className="col-span-2 rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
            Space Recovered Over Time
          </h3>
          {timelineData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="spaceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: '#4e4e56', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#4e4e56', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => formatBytes(v, 0)} width={60} />
                <Tooltip
                  contentStyle={{ background: '#1e1e22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: '#a1a1aa' }}
                  formatter={(value) => [formatBytes(Number(value)), 'Space']}
                />
                <Area type="monotone" dataKey="space" stroke="#f59e0b" strokeWidth={2}
                  fill="url(#spaceGrad)" dot={false} activeDot={{ r: 4, fill: '#f59e0b' }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[13px]" style={{ color: '#4e4e56' }}>
              Need at least 2 scans for trend chart
            </div>
          )}
        </div>

        {/* Scan type distribution */}
        <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
            Scan Type Distribution
          </h3>
          {typeBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={typeBreakdown}
                    cx="50%" cy="50%"
                    innerRadius={40} outerRadius={60}
                    dataKey="count"
                    stroke="none"
                  >
                    {typeBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e1e22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                    formatter={(value) => [Number(value), 'Scans']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {typeBreakdown.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="flex-1 text-[12px] text-zinc-400">{item.name}</span>
                    <span className="font-mono text-[11px]" style={{ color: '#6e6e76' }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-[13px]" style={{ color: '#4e4e56' }}>
              No data
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2 — Bar charts */}
      <div className="mb-5 grid grid-cols-2 gap-4">
        {/* Category breakdown */}
        <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
            Top Categories by Space
          </h3>
          {categoryBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryBreakdown} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#4e4e56', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => formatBytes(v, 0)} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false}
                  tickLine={false} width={90} />
                <Tooltip
                  contentStyle={{ background: '#1e1e22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  formatter={(value) => [formatBytes(Number(value)), 'Space']}
                />
                <Bar dataKey="space" radius={[0, 6, 6, 0]}>
                  {categoryBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[13px]" style={{ color: '#4e4e56' }}>
              No category data
            </div>
          )}
        </div>

        {/* Weekly trend */}
        <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
            Weekly Activity
          </h3>
          {weeklyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="week" tick={{ fill: '#4e4e56', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#4e4e56', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1e1e22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: '#a1a1aa' }}
                  formatter={(value, name) => [
                    name === 'count' ? Number(value) : formatBytes(Number(value)),
                    name === 'count' ? 'Scans' : 'Space'
                  ]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} fillOpacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-[13px]" style={{ color: '#4e4e56' }}>
              Need at least 2 weeks of data
            </div>
          )}
        </div>
      </div>

      {/* Recent 5 scans summary */}
      <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
          Recent Scans
        </h3>
        <div className="space-y-2">
          {entries.slice(0, 5).map((entry) => (
            <RecentScanRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </>
  )
}

// ============ Timeline View ============

function TimelineView({
  entries,
  typeFilter,
  setTypeFilter,
  expandedEntry,
  setExpandedEntry
}: {
  entries: ScanHistoryEntry[]
  typeFilter: 'all' | ScanHistoryEntry['type']
  setTypeFilter: (f: 'all' | ScanHistoryEntry['type']) => void
  expandedEntry: string | null
  setExpandedEntry: (id: string | null) => void
}) {
  const filters: { label: string; value: 'all' | ScanHistoryEntry['type'] }[] = [
    { label: 'All', value: 'all' },
    { label: 'Cleaner', value: 'cleaner' },
    { label: 'Registry', value: 'registry' },
    { label: 'Debloater', value: 'debloater' },
    { label: 'Network', value: 'network' },
    { label: 'Drivers', value: 'drivers' }
  ]

  return (
    <>
      {/* Filter pills */}
      <div className="mb-5 flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: typeFilter === f.value ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)',
              color: typeFilter === f.value ? '#f59e0b' : '#6e6e76'
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] font-mono" style={{ color: '#4e4e56' }}>
          {entries.length} entries
        </span>
      </div>

      {/* Entries */}
      <div className="space-y-2.5">
        {entries.map((entry) => {
          const config = typeConfig[entry.type]
          const Icon = config.icon
          const isExpanded = expandedEntry === entry.id

          return (
            <div
              key={entry.id}
              className="overflow-hidden rounded-2xl transition-all"
              style={{ background: '#16161a', border: `1px solid ${isExpanded ? config.color + '30' : 'rgba(255,255,255,0.05)'}` }}
            >
              {/* Entry header */}
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors"
                style={{ background: isExpanded ? config.bg.replace('0.1', '0.03') : 'transparent' }}
                onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: config.bg }}
                >
                  <Icon className="h-5 w-5" style={{ color: config.color }} strokeWidth={1.8} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-semibold text-zinc-200">{config.label}</span>
                    {entry.errorCount > 0 && (
                      <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                        <AlertCircle className="h-3 w-3" strokeWidth={2} />
                        {entry.errorCount} error{entry.errorCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: '#5e5e66' }}>
                    {entry.totalItemsCleaned.toLocaleString()} items processed
                    {entry.totalSpaceSaved > 0 && ` · ${formatBytes(entry.totalSpaceSaved)} recovered`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#6e6e76' }}>
                    <Calendar className="h-3.5 w-3.5" strokeWidth={1.6} />
                    {new Date(entry.timestamp).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric'
                    })}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: '#4e4e56' }}>
                    <Clock className="h-3 w-3" strokeWidth={1.6} />
                    {formatDuration(entry.duration)}
                  </div>
                </div>

                <ChevronDown
                  className="h-4 w-4 shrink-0 transition-transform"
                  style={{ color: '#4e4e56', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  strokeWidth={2}
                />
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  {/* Summary stats row */}
                  <div className="grid grid-cols-4 gap-3 p-5">
                    <DetailStat label="Found" value={entry.totalItemsFound.toLocaleString()} />
                    <DetailStat label="Processed" value={entry.totalItemsCleaned.toLocaleString()} />
                    <DetailStat label="Skipped" value={entry.totalItemsSkipped.toLocaleString()} />
                    <DetailStat label="Space Saved" value={entry.totalSpaceSaved > 0 ? formatBytes(entry.totalSpaceSaved) : '—'} />
                  </div>

                  {/* Category breakdown bar chart */}
                  {entry.categories.length > 0 && (
                    <div className="px-5 pb-5">
                      <h4 className="mb-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>
                        Category Breakdown
                      </h4>
                      <div className="space-y-2">
                        {entry.categories.map((cat, i) => {
                          const maxItems = Math.max(...entry.categories.map((c) => c.itemsCleaned), 1)
                          const percent = (cat.itemsCleaned / maxItems) * 100
                          return (
                            <div key={cat.name} className="flex items-center gap-3">
                              <span className="w-24 shrink-0 truncate text-[12px] capitalize text-zinc-400">
                                {cat.name}
                              </span>
                              <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${percent}%`,
                                    background: PIE_COLORS[i % PIE_COLORS.length],
                                    opacity: 0.8
                                  }}
                                />
                              </div>
                              <span className="w-16 shrink-0 text-right font-mono text-[11px]" style={{ color: '#6e6e76' }}>
                                {cat.itemsCleaned}
                              </span>
                              {cat.spaceSaved > 0 && (
                                <span className="w-20 shrink-0 text-right font-mono text-[11px]" style={{ color: '#4e4e56' }}>
                                  {formatBytes(cat.spaceSaved)}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {entries.length === 0 && (
          <div className="py-12 text-center text-[13px]" style={{ color: '#4e4e56' }}>
            No entries match this filter
          </div>
        )}
      </div>
    </>
  )
}

// ============ Shared Components ============

function MiniStat({ icon: Icon, label, value, color }: { icon: typeof BarChart3; label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.8} />
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#52525e' }}>{label}</span>
      </div>
      <span className="text-[20px] font-bold tracking-tight text-zinc-100">{value}</span>
    </div>
  )
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#4e4e56' }}>{label}</p>
      <p className="mt-1 text-[16px] font-semibold text-zinc-200">{value}</p>
    </div>
  )
}

function RecentScanRow({ entry }: { entry: ScanHistoryEntry }) {
  const config = typeConfig[entry.type]
  const Icon = config.icon

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
      style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: config.bg }}>
        <Icon className="h-4 w-4" style={{ color: config.color }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-medium text-zinc-300">{config.label}</span>
        <p className="text-[11px]" style={{ color: '#4e4e56' }}>
          {entry.totalItemsCleaned.toLocaleString()} items
          {entry.totalSpaceSaved > 0 && ` · ${formatBytes(entry.totalSpaceSaved)}`}
        </p>
      </div>
      <span className="shrink-0 text-[11px]" style={{ color: '#4e4e56' }}>
        {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </span>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}
