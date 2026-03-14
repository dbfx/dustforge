import { useState, useMemo } from 'react'
import { Download, Cpu } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { SoftwareUpdaterPage } from './SoftwareUpdaterPage'
import { DriverManagerPage } from './DriverManagerPage'
import { usePlatform } from '@/hooks/usePlatform'
import type { LucideIcon } from 'lucide-react'

interface TabDef {
  id: string
  label: string
  icon: LucideIcon
  description: string
}

const tabs: TabDef[] = [
  { id: 'software', label: 'Software', icon: Download, description: 'Third-party apps via winget' },
  { id: 'drivers', label: 'Drivers', icon: Cpu, description: 'Updates & stale cleanup' }
]

export function UpdatesPage() {
  const { features } = usePlatform()
  const [activeTab, setActiveTab] = useState('software')

  const visibleTabs = useMemo(() =>
    tabs.filter((tab) => {
      if (tab.id === 'drivers' && !features.drivers) return false
      return true
    }),
    [features.drivers]
  )

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Updates"
        description="Keep your software and drivers up to date"
      />

      {/* Tab bar */}
      <div
        className="mb-6 flex rounded-xl p-1"
        style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id
          const TabIcon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2.5 rounded-lg px-4 py-3 text-[13px] font-medium transition-all',
                isActive ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
              )}
              style={isActive ? { background: 'rgba(245,158,11,0.08)' } : undefined}
            >
              <TabIcon className="h-4 w-4 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{tab.label}</span>
              <span className="hidden text-[11px] sm:inline" style={{ color: isActive ? '#b08c2a' : '#4e4e56' }}>
                {tab.description}
              </span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'software' && <SoftwareUpdaterPage embedded />}
      {activeTab === 'drivers' && <DriverManagerPage embedded />}
    </div>
  )
}
