import { cn } from '@/lib/utils'

interface GaugeCardProps {
  label: string
  percent: number
  detail: string
  className?: string
}

function getColor(pct: number): string {
  if (pct >= 85) return '#ef4444'
  if (pct >= 60) return '#f59e0b'
  return '#22c55e'
}

const SIZE = 120
const STROKE = 6
const RADIUS = (SIZE - STROKE * 2) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function GaugeCard({ label, percent, detail, className }: GaugeCardProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE
  const color = getColor(clamped)

  return (
    <div
      className={cn('flex flex-col items-center rounded-2xl p-5', className)}
      style={{
        background: '#16161a',
        border: '1px solid rgba(255,255,255,0.05)'
      }}
    >
      <div className="relative inline-flex items-center justify-center">
        {/* Glow */}
        <div
          className="absolute rounded-full opacity-15 blur-2xl"
          style={{ width: SIZE * 0.5, height: SIZE * 0.5, backgroundColor: color }}
        />

        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>

        <div className="absolute flex flex-col items-center">
          <span className="text-[26px] font-bold tracking-tight text-white">
            {Math.round(clamped)}
          </span>
          <span className="text-[10px] font-medium" style={{ color: '#52525e' }}>%</span>
        </div>
      </div>

      <span className="mt-3 text-[13px] font-semibold text-white">{label}</span>
      <span className="mt-0.5 text-[11px] font-medium" style={{ color: '#6e6e76' }}>
        {detail}
      </span>
    </div>
  )
}
