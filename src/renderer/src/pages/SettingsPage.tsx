import { useState, useEffect } from 'react'
import { Github, Bug, ExternalLink, Plus, X, FolderOpen, Clock } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
import logoSrc from '@/assets/logo.png'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatNextScan(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  if (days === 0 && hours > 0) return `Today at ${timeStr} (in ${hours}h)`
  if (days === 1) return `Tomorrow at ${timeStr}`
  if (days < 7) return `${dateStr} at ${timeStr} (in ${days} days)`
  return `${dateStr} at ${timeStr}`
}

export function SettingsPage() {
  const { settings, updateSettings, setSettings } = useSettingsStore()
  const [newExclusion, setNewExclusion] = useState('')
  const [nextScan, setNextScan] = useState<string | null>(null)

  useEffect(() => { window.dustforge?.settingsGet?.().then(setSettings).catch(() => {}) }, [])

  // Fetch next scan time whenever schedule settings change
  useEffect(() => {
    if (settings.schedule.enabled) {
      window.dustforge?.scheduleNextScan?.().then(setNextScan).catch(() => setNextScan(null))
    } else {
      setNextScan(null)
    }
  }, [settings.schedule.enabled, settings.schedule.frequency, settings.schedule.hour, settings.schedule.day])

  const save = (partial: Partial<typeof settings>) => {
    updateSettings(partial)
    window.dustforge?.settingsSet?.(partial).catch(() => {})
  }

  const saveStartup = (enabled: boolean) => {
    save({ runAtStartup: enabled })
    window.dustforge?.applyStartup?.(enabled)
  }

  const saveTray = (enabled: boolean) => {
    save({ minimizeToTray: enabled })
    window.dustforge?.applyTray?.(enabled)
  }

  const saveSchedule = (schedule: typeof settings.schedule) => {
    save({ schedule })
    // When enabling scheduled scans, also enable run-at-startup and tray
    // so the app stays alive to run them
    if (schedule.enabled && !settings.runAtStartup) {
      save({ runAtStartup: true })
      window.dustforge?.applyStartup?.(true)
    }
    if (schedule.enabled && !settings.minimizeToTray) {
      save({ minimizeToTray: true })
      window.dustforge?.applyTray?.(true)
    }
  }

  const addExclusion = () => {
    const value = newExclusion.trim()
    if (!value) return
    // Must be an absolute path: drive letter (C:\...) or UNC path (\\server\share), or a *.ext glob
    const isDrivePath = /^[A-Za-z]:\\/.test(value)
    const isUncPath = /^\\\\[A-Za-z0-9]/.test(value)
    const isGlob = /^\*\.[A-Za-z0-9]+$/.test(value)
    // Reject relative path traversal sequences
    if (value.includes('..')) return
    if (!isDrivePath && !isUncPath && !isGlob) return
    // Prevent duplicates
    if (settings.exclusions.includes(value)) return
    save({ exclusions: [...settings.exclusions, value] })
    setNewExclusion('')
  }

  const selectStyle = "rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 outline-none"
  const selectBorder = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }

  return (
    <div className="animate-fade-in max-w-2xl">
      <PageHeader title="Settings" description="Configure DustForge preferences" />

      <Section title="General">
        <Row label="Run at startup" desc="Launch DustForge when Windows starts">
          <Toggle checked={settings.runAtStartup} onChange={saveStartup} />
        </Row>
        <Row label="Minimize to tray" desc="Keep running in system tray when closed">
          <Toggle checked={settings.minimizeToTray} onChange={saveTray} />
        </Row>
        <Row label="Show notifications" desc="Display a notification when operations complete">
          <Toggle checked={settings.showNotificationOnComplete} onChange={(v) => save({ showNotificationOnComplete: v })} />
        </Row>
        <Row label="Auto-update" desc="Automatically download and install updates" last>
          <Toggle checked={settings.autoUpdate} onChange={(v) => save({ autoUpdate: v })} />
        </Row>
      </Section>

      <Section title="Cleaning Preferences">
        <Row label="Secure delete (slower)" desc="Overwrite files before deletion for sensitive data (slower)">
          <Toggle checked={settings.cleaner.secureDelete} onChange={(v) => save({ cleaner: { ...settings.cleaner, secureDelete: v } })} />
        </Row>
        <Row label="Close browsers before clean" desc="Automatically close browsers to unlock cache files">
          <Toggle checked={settings.cleaner.closeBrowsersBeforeClean} onChange={(v) => save({ cleaner: { ...settings.cleaner, closeBrowsersBeforeClean: v } })} />
        </Row>
        <Row label="Create restore point" desc="Create a system restore point before cleaning (requires admin)">
          <Toggle checked={settings.cleaner.createRestorePoint} onChange={(v) => save({ cleaner: { ...settings.cleaner, createRestorePoint: v } })} />
        </Row>
        <Row label="Skip recent files" desc="Don't delete files modified within this time" last>
          <select value={settings.cleaner.skipRecentMinutes}
            onChange={(e) => save({ cleaner: { ...settings.cleaner, skipRecentMinutes: Number(e.target.value) } })}
            className={selectStyle} style={selectBorder}>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
            <option value={1440}>24 hours</option>
          </select>
        </Row>
      </Section>

      <Section title="Exclusions">
        <div className="space-y-2 pb-3">
          {settings.exclusions.length === 0 && (
            <p className="text-[13px]" style={{ color: '#4e4e56' }}>No exclusions configured</p>
          )}
          {settings.exclusions.map((exc, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl px-4 py-2.5"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="flex items-center gap-2.5">
                <FolderOpen className="h-3.5 w-3.5" style={{ color: '#4e4e56' }} strokeWidth={1.8} />
                <span className="font-mono text-[12px] text-zinc-400">{exc}</span>
              </div>
              <button onClick={() => save({ exclusions: settings.exclusions.filter((_, j) => j !== i) })}
                className="rounded-lg p-1.5 transition-colors" style={{ color: '#4e4e56' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2.5">
            <input type="text" value={newExclusion} onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
              placeholder="C:\path\to\exclude or *.ext"
              className="flex-1 rounded-xl px-4 py-2.5 text-[13px] text-zinc-300 outline-none placeholder:text-zinc-700"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
            <button onClick={addExclusion}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </div>
      </Section>

      <Section title="Scheduled Scans">
        <Row label="Enable scheduled scans" desc="Automatically scan on a schedule">
          <Toggle checked={settings.schedule.enabled} onChange={(v) => saveSchedule({ ...settings.schedule, enabled: v })} />
        </Row>
        {settings.schedule.enabled && (
          <>
            <Row label="Frequency" desc="How often to scan">
              <select value={settings.schedule.frequency}
                onChange={(e) => saveSchedule({ ...settings.schedule, frequency: e.target.value as 'daily' | 'weekly' | 'monthly' })}
                className={selectStyle} style={selectBorder}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Row>
            {settings.schedule.frequency === 'weekly' && (
              <Row label="Day of week" desc="Which day to scan">
                <select value={settings.schedule.day}
                  onChange={(e) => saveSchedule({ ...settings.schedule, day: Number(e.target.value) })}
                  className={selectStyle} style={selectBorder}>
                  {DAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
                </select>
              </Row>
            )}
            {settings.schedule.frequency === 'monthly' && (
              <Row label="Day of month" desc="Which day to scan">
                <select value={settings.schedule.day}
                  onChange={(e) => saveSchedule({ ...settings.schedule, day: Number(e.target.value) })}
                  className={selectStyle} style={selectBorder}>
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{ordinal(i + 1)}</option>
                  ))}
                </select>
              </Row>
            )}
            <Row label="Time" desc="Time of day to scan" last={!nextScan}>
              <select value={settings.schedule.hour}
                onChange={(e) => saveSchedule({ ...settings.schedule, hour: Number(e.target.value) })}
                className={selectStyle} style={selectBorder}>
                {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
              </select>
            </Row>
            {nextScan && (
              <div className="flex items-center gap-2.5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
                <span className="text-[12px]" style={{ color: '#8e8e96' }}>
                  Next scan: {formatNextScan(nextScan)}
                </span>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="About">
        <div className="py-3">
          <div className="flex items-center gap-4">
            <img src={logoSrc} alt="DustForge" className="h-11 w-11 rounded-xl" />
            <div>
              <p className="text-[14px] font-medium text-zinc-200">DustForge v1.0.0</p>
              <p className="text-[12px]" style={{ color: '#52525e' }}>MIT License · Open Source</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2.5">
            <LinkButton icon={Github} label="GitHub" href="https://github.com/dustforge/dustforge" />
            <LinkButton icon={Bug} label="Report Bug" href="https://github.com/dustforge/dustforge/issues" />
          </div>
        </div>
      </Section>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-widest" style={{ color: '#4e4e56' }}>{title}</h3>
      <div className="rounded-2xl p-5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>{children}</div>
    </div>
  )
}

function Row({ label, desc, children, last }: { label: string; desc?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between py-3.5', !last && 'border-b')}
      style={!last ? { borderColor: 'rgba(255,255,255,0.04)' } : undefined}>
      <div>
        <p className="text-[13px] font-medium text-zinc-300">{label}</p>
        {desc && <p className="mt-0.5 text-[12px]" style={{ color: '#52525e' }}>{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
      style={{ background: checked ? '#f59e0b' : 'rgba(255,255,255,0.08)' }}>
      <div className={cn(
        'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
      )} />
    </button>
  )
}

function LinkButton({ icon: Icon, label, href }: { icon: typeof Github; label: string; href: string }) {
  return (
    <button
      onClick={() => window.open(href, '_blank')}
      className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium text-zinc-500 transition-colors"
      style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} /> {label} <ExternalLink className="h-3 w-3 opacity-50" />
    </button>
  )
}
