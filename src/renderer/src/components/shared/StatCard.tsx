import { cn } from '@/lib/utils'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: number
  displayValue?: string
  unit?: string
  variant?: 'default' | 'accent' | 'success' | 'danger'
  className?: string
}

export function StatCard({
  icon: Icon,
  label,
  value,
  displayValue,
  unit,
  variant = 'default',
  className
}: StatCardProps) {
  const animatedValue = useAnimatedCounter(value)

  const iconColors = {
    default: '#52525b',
    accent: '#f59e0b',
    success: '#22c55e',
    danger: '#ef4444'
  }

  return (
    <div
      className={cn('rounded-2xl p-5 transition-colors', className)}
      style={{
        background: variant === 'accent'
          ? 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, #16161a 60%)'
          : '#16161a',
        border: `1px solid ${variant === 'accent' ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)'}`
      }}
    >
      <Icon className="mb-4 h-5 w-5" style={{ color: iconColors[variant] }} strokeWidth={1.8} />
      <div className="flex items-baseline gap-1.5">
        <span className="text-[24px] font-bold tracking-tight text-white">
          {displayValue ?? Math.round(animatedValue).toLocaleString()}
        </span>
        {unit && <span className="text-[12px] font-medium" style={{ color: '#6e6e76' }}>{unit}</span>}
      </div>
      <p className="mt-1 text-[12px] font-medium" style={{ color: '#52525e' }}>{label}</p>
    </div>
  )
}
