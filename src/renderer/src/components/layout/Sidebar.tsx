import { useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Sparkles,
  Database,
  Zap,
  HardDrive,
  Settings,
  PackageMinus,
  Wifi,
  History
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import logoSrc from '@/assets/logo.png'

interface NavItemDef {
  icon: LucideIcon
  label: string
  path: string
}

interface NavGroup {
  heading?: string
  items: NavItemDef[]
}

const navGroups: NavGroup[] = [
  {
    items: [{ icon: LayoutDashboard, label: 'Dashboard', path: '/' }]
  },
  {
    heading: 'MAINTAIN',
    items: [
      { icon: Sparkles, label: 'Cleaner', path: '/cleaner' },
      { icon: Database, label: 'Registry', path: '/registry' },
      { icon: Zap, label: 'Startup', path: '/startup' },
      { icon: Wifi, label: 'Network', path: '/network' }
    ]
  },
  {
    heading: 'TOOLS',
    items: [
      { icon: HardDrive, label: 'Disk Analyzer', path: '/disk' },
      { icon: PackageMinus, label: 'Debloater', path: '/debloater' },
      { icon: History, label: 'History', path: '/history' }
    ]
  }
]

const bottomNavItems: NavItemDef[] = [
  { icon: Settings, label: 'Settings', path: '/settings' }
]

export function Sidebar() {
  return (
    <div
      className="flex h-full w-[220px] shrink-0 flex-col"
      style={{ background: '#111114', borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Logo — doubles as drag region */}
      <div className="drag-region flex items-center gap-3 px-5 pb-4 pt-6">
        <img src={logoSrc} alt="DustForge" className="h-9 w-9 shrink-0 rounded-xl" />
        <div>
          <div className="text-[14px] font-semibold text-white">DustForge</div>
          <div className="text-[10px] font-medium tracking-wide" style={{ color: '#636369' }}>
            SYSTEM CLEANER
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="mt-2 flex-1 px-3">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
            {group.heading && (
              <div
                className="mb-1 px-3 pt-1 text-[10px] font-semibold tracking-widest"
                style={{ color: '#4e4e56' }}
              >
                {group.heading}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.path} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        {bottomNavItems.map((item) => (
          <NavItem key={item.path} item={item} />
        ))}
      </div>
    </div>
  )
}

function NavItem({ item }: { item: NavItemDef }) {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = location.pathname === item.path

  return (
    <button
      onClick={() => navigate(item.path)}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150',
        isActive
          ? 'text-amber-400'
          : 'text-zinc-500 hover:text-zinc-300'
      )}
      style={isActive ? { background: 'rgba(245,158,11,0.08)' } : undefined}
    >
      {isActive && (
        <div
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{ background: '#f59e0b' }}
        />
      )}
      <item.icon
        className={cn(
          'h-[17px] w-[17px] shrink-0 transition-colors',
          isActive ? 'text-amber-400' : 'text-zinc-600 group-hover:text-zinc-400'
        )}
        strokeWidth={isActive ? 2.2 : 1.8}
      />
      <span>{item.label}</span>
    </button>
  )
}
