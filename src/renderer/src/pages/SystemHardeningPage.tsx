import { useState } from 'react'
import { Shield, Eye, PackageMinus, Server } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { PrivacyShieldPage } from './PrivacyShieldPage'
import { DebloaterPage } from './DebloaterPage'
import { ServiceManagerPage } from './ServiceManagerPage'
import type { LucideIcon } from 'lucide-react'

interface TabDef {
  id: string
  label: string
  icon: LucideIcon
  description: string
}

const tabs: TabDef[] = [
  { id: 'privacy', label: 'Privacy', icon: Eye, description: 'Telemetry, ads, tracking' },
  { id: 'bloatware', label: 'Bloatware', icon: PackageMinus, description: 'Pre-installed apps' },
  { id: 'services', label: 'Services', icon: Server, description: 'Unnecessary services' }
]

export function SystemHardeningPage() {
  const [activeTab, setActiveTab] = useState('privacy')

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="System Hardening"
        description="Strip down Windows — remove telemetry, bloatware, and unnecessary services"
      />

      {/* Tab bar */}
      <div
        className="mb-6 flex rounded-xl p-1"
        style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        {tabs.map((tab) => {
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
      {activeTab === 'privacy' && <PrivacyShieldPage embedded />}
      {activeTab === 'bloatware' && <DebloaterPage embedded />}
      {activeTab === 'services' && <ServiceManagerPage embedded />}
    </div>
  )
}
