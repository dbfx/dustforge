import { useState, useCallback, useEffect, useRef } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  Eye,
  Search,
  Megaphone,
  Radio,
  RefreshCw,
  CalendarClock,
  CheckCircle2,
  Loader2,
  AlertTriangle
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import type { PrivacySetting, PrivacyShieldState, PrivacyApplyResult, PrivacyScanProgress } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

interface CategoryDef {
  id: PrivacySetting['category']
  label: string
  description: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

const categories: CategoryDef[] = [
  {
    id: 'telemetry',
    label: 'Telemetry & Data Collection',
    description: 'Control what diagnostic and usage data Windows sends to Microsoft',
    icon: Radio,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.15)'
  },
  {
    id: 'ads',
    label: 'Ads & Suggestions',
    description: 'Block promoted apps, ad suggestions, and lock screen spotlight',
    icon: Megaphone,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.15)'
  },
  {
    id: 'search',
    label: 'Search & Cortana',
    description: 'Keep searches local and disable web-based search features',
    icon: Search,
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.15)'
  },
  {
    id: 'sync',
    label: 'Sync & Cloud',
    description: 'Control clipboard syncing, settings sync, and device tracking',
    icon: RefreshCw,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    border: 'rgba(139,92,246,0.15)'
  },
  {
    id: 'services',
    label: 'Telemetry Services',
    description: 'Disable background services that collect and upload telemetry',
    icon: Eye,
    color: '#14b8a6',
    bg: 'rgba(20,184,166,0.08)',
    border: 'rgba(20,184,166,0.15)'
  },
  {
    id: 'tasks',
    label: 'Scheduled Tasks',
    description: 'Disable Microsoft telemetry scheduled tasks running in the background',
    icon: CalendarClock,
    color: '#a3e635',
    bg: 'rgba(163,230,53,0.08)',
    border: 'rgba(163,230,53,0.15)'
  }
]

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 6) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={4}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[20px] font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] font-medium" style={{ color: '#52525e' }}>/ 100</span>
      </div>
    </div>
  )
}

export function PrivacyShieldPage() {
  const [state, setState] = useState<PrivacyShieldState | null>(null)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'applying' | 'done'>('idle')
  const [applyResult, setApplyResult] = useState<PrivacyApplyResult | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<PrivacyScanProgress | null>(null)
  const progressCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { progressCleanupRef.current?.() }
  }, [])

  const handleScan = useCallback(async () => {
    setStatus('scanning')
    setApplyResult(null)
    setProgress(null)

    // Listen for progress
    progressCleanupRef.current?.()
    progressCleanupRef.current = window.dustforge.onPrivacyProgress?.((data) => {
      setProgress(data)
    }) ?? null

    try {
      const result = await window.dustforge.privacyScan()
      setState(result)
      // Auto-expand categories with unprotected settings
      const unprotected = new Set<string>()
      for (const s of result.settings) {
        if (!s.enabled) unprotected.add(s.category)
      }
      setExpandedCategories(unprotected)
      setStatus('done')
    } catch (err) {
      console.error('Privacy scan failed:', err)
      setStatus('idle')
    } finally {
      progressCleanupRef.current?.()
      progressCleanupRef.current = null
      setProgress(null)
    }
  }, [])

  const handleApplyAll = useCallback(async () => {
    if (!state) return
    const unprotectedIds = state.settings.filter(s => !s.enabled).map(s => s.id)
    if (unprotectedIds.length === 0) return

    setStatus('applying')
    setApplyResult(null)
    try {
      const result = await window.dustforge.privacyApply(unprotectedIds)
      setApplyResult(result)
      // Re-scan to get updated state
      const updated = await window.dustforge.privacyScan()
      setState(updated)
      setStatus('done')
    } catch {
      setStatus('done')
    }
  }, [state])

  const handleApplyCategory = useCallback(async (categoryId: string) => {
    if (!state) return
    const ids = state.settings.filter(s => s.category === categoryId && !s.enabled).map(s => s.id)
    if (ids.length === 0) return

    setStatus('applying')
    setApplyResult(null)
    try {
      const result = await window.dustforge.privacyApply(ids)
      setApplyResult(result)
      const updated = await window.dustforge.privacyScan()
      setState(updated)
      setStatus('done')
    } catch {
      setStatus('done')
    }
  }, [state])

  const handleToggleSingle = useCallback(async (settingId: string) => {
    if (!state) return
    const setting = state.settings.find(s => s.id === settingId)
    if (!setting || setting.enabled) return // can only enable protection, not disable it from here

    setStatus('applying')
    try {
      await window.dustforge.privacyApply([settingId])
      const updated = await window.dustforge.privacyScan()
      setState(updated)
      setStatus('done')
    } catch {
      setStatus('done')
    }
  }, [state])

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const isScanning = status === 'scanning'
  const isApplying = status === 'applying'
  const busy = isScanning || isApplying
  const unprotectedCount = state ? state.total - state.protected : 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Privacy Shield"
        description="Control telemetry, ads, tracking, and data collection across Windows"
        action={
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleScan}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <Eye className="h-4 w-4" strokeWidth={1.8} />
              Scan
            </button>
            {state && unprotectedCount > 0 && (
              <button
                onClick={handleApplyAll}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
                style={{
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 20px rgba(34,197,94,0.2)'
                }}
              >
                <ShieldCheck className="h-4 w-4" strokeWidth={2} />
                Protect All ({unprotectedCount})
              </button>
            )}
          </div>
        }
      />

      {/* Score + stats cards */}
      {state && !isScanning && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {/* Privacy score */}
          <div className="rounded-2xl p-5 flex items-center gap-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
            <ScoreRing score={state.score} />
            <div>
              <p className="text-[14px] font-semibold text-zinc-200">Privacy Score</p>
              <p className="text-[12px] mt-0.5" style={{ color: '#6e6e76' }}>
                {state.score >= 80 ? 'Well protected' : state.score >= 50 ? 'Needs improvement' : 'At risk'}
              </p>
            </div>
          </div>

          {/* Protection status */}
          <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 mb-2">
              {unprotectedCount === 0 ? (
                <ShieldCheck className="h-5 w-5 text-green-500" strokeWidth={1.8} />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-500" strokeWidth={1.8} />
              )}
              <span className="text-[13px] font-medium text-zinc-200">
                {unprotectedCount === 0 ? 'Fully Protected' : `${unprotectedCount} Unprotected`}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(state.protected / state.total) * 100}%`,
                    background: state.score >= 80 ? '#22c55e' : state.score >= 50 ? '#f59e0b' : '#ef4444'
                  }}
                />
              </div>
              <span className="text-[12px] font-mono" style={{ color: '#6e6e76' }}>
                {state.protected}/{state.total}
              </span>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: '#52525e' }}>Categories</p>
            <div className="space-y-1.5">
              {categories.map(cat => {
                const catSettings = state.settings.filter(s => s.category === cat.id)
                if (catSettings.length === 0) return null
                const protectedInCat = catSettings.filter(s => s.enabled).length
                const allGood = protectedInCat === catSettings.length
                return (
                  <div key={cat.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ background: allGood ? '#22c55e' : cat.color }} />
                      <span className="text-[11px] text-zinc-400">{cat.label.split(' ')[0]}</span>
                    </div>
                    <span className="text-[11px] font-mono" style={{ color: allGood ? '#22c55e' : '#6e6e76' }}>
                      {protectedInCat}/{catSettings.length}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Scanning progress */}
      {isScanning && (
        <div className="mb-5 rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-400 border-t-transparent" />
            <span className="text-[13px] font-medium text-zinc-200">
              {progress ? `Checking: ${progress.currentLabel}` : 'Preparing scan...'}
            </span>
            {progress && (
              <span className="ml-auto text-[12px] font-mono text-zinc-500">
                {progress.current} / {progress.total}
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress ? (progress.current / progress.total) * 100 : 0}%`,
                background: 'linear-gradient(90deg, #22c55e, #16a34a)'
              }}
            />
          </div>

          {/* Category pills showing which categories have been checked */}
          {progress && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map(cat => {
                const catLabel = cat.label.split(' ')[0]
                const isCurrent = progress.category === cat.id
                const catIdx = categories.findIndex(c => c.id === cat.id)
                const currentCatIdx = categories.findIndex(c => c.id === progress.category)
                const isDone = catIdx < currentCatIdx

                return (
                  <div
                    key={cat.id}
                    className="flex items-center gap-1 rounded-md px-2 py-1"
                    style={{
                      background: isCurrent ? 'rgba(34,197,94,0.1)' : isDone ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isCurrent ? 'rgba(34,197,94,0.2)' : isDone ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)'}`
                    }}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" strokeWidth={2} />
                    ) : isCurrent ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-green-400 border-t-transparent" />
                    ) : (
                      <div className="h-3 w-3 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    )}
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: isCurrent ? '#4ade80' : isDone ? '#4ade80' : '#52525e' }}
                    >
                      {catLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Applying state */}
      {isApplying && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
          <Loader2 className="h-4 w-4 animate-spin text-green-400" />
          <span className="text-[13px] text-zinc-400">Applying privacy protections...</span>
        </div>
      )}

      {/* Apply result */}
      {applyResult && status === 'done' && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.04)' : 'rgba(34,197,94,0.06)',
            border: `1px solid ${applyResult.failed > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)'}`
          }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">
                {applyResult.succeeded} setting{applyResult.succeeded !== 1 ? 's' : ''} applied
              </p>
              {applyResult.failed > 0 && (
                <p className="text-[12px] mt-0.5" style={{ color: '#f59e0b' }}>
                  {applyResult.failed} failed — may require administrator privileges
                </p>
              )}
            </div>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-3 ml-8 space-y-1">
              {applyResult.errors.map((err) => (
                <p key={err.id} className="text-[11px] font-mono" style={{ color: '#6e6e76' }}>
                  {err.label}: {err.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!state && !isScanning && (
        <EmptyState
          icon={Eye}
          title="Privacy Shield"
          description='Click "Scan" to audit your Windows privacy settings and block telemetry, ads, and tracking.'
        />
      )}

      {/* Category cards */}
      {state && !isScanning && (
        <div className="space-y-3">
          {categories.map(cat => {
            const catSettings = state.settings.filter(s => s.category === cat.id)
            if (catSettings.length === 0) return null

            const protectedInCat = catSettings.filter(s => s.enabled).length
            const allProtected = protectedInCat === catSettings.length
            const isExpanded = expandedCategories.has(cat.id)
            const unprotectedInCat = catSettings.length - protectedInCat
            const CatIcon = cat.icon

            return (
              <div key={cat.id} className="overflow-hidden rounded-2xl"
                style={{
                  border: `1px solid ${allProtected ? 'rgba(34,197,94,0.15)' : cat.border}`,
                  opacity: isApplying ? 0.5 : 1,
                  pointerEvents: isApplying ? 'none' : 'auto'
                }}>
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors"
                  style={{ background: allProtected ? 'rgba(34,197,94,0.03)' : 'rgba(255,255,255,0.02)' }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: allProtected ? 'rgba(34,197,94,0.1)' : cat.bg }}>
                    <CatIcon className="h-5 w-5" style={{ color: allProtected ? '#22c55e' : cat.color }} strokeWidth={1.8} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[14px] font-semibold text-zinc-200">{cat.label}</span>
                      {allProtected ? (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                          All protected
                        </span>
                      ) : (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: cat.bg, color: cat.color }}>
                          {unprotectedInCat} unprotected
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px]" style={{ color: '#5e5e66' }}>{cat.description}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {!allProtected && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleApplyCategory(cat.id)
                        }}
                        disabled={busy}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                      >
                        Protect All
                      </button>
                    )}
                    {allProtected && (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full"
                        style={{ background: 'rgba(34,197,94,0.1)' }}>
                        <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={2.5} />
                      </div>
                    )}
                    <div
                      className={cn(
                        'h-5 w-5 transition-transform',
                        isExpanded ? 'rotate-180' : 'rotate-0'
                      )}
                      style={{ color: '#6e6e76' }}
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded settings */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    {catSettings.map((setting, i) => (
                      <div key={setting.id}
                        className="flex items-center gap-4 px-5 py-3.5"
                        style={{
                          borderBottom: i < catSettings.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none'
                        }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-zinc-300">{setting.label}</span>
                            {setting.requiresAdmin && (
                              <span className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                                style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                                Admin
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px]" style={{ color: '#5e5e66' }}>{setting.description}</p>
                        </div>

                        {/* Toggle switch */}
                        <button
                          onClick={() => !setting.enabled && handleToggleSingle(setting.id)}
                          disabled={busy || setting.enabled}
                          className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
                          style={{ background: setting.enabled ? '#22c55e' : 'rgba(255,255,255,0.08)' }}
                        >
                          <div className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
                            style={{
                              left: setting.enabled ? '22px' : '2px',
                              background: setting.enabled ? '#fff' : '#6e6e76'
                            }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Admin warning */}
      {state && unprotectedCount > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl px-5 py-3"
          style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.08)' }}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[11px]" style={{ color: '#8e8e96' }}>
            Some settings require <span className="font-semibold text-amber-500">administrator privileges</span> to modify. Run DustForge as administrator for full protection.
          </p>
        </div>
      )}
    </div>
  )
}
