import { cn } from '@/lib/utils'
import { formatBytes, formatNumber } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface CategoryCheckboxProps {
  label: string
  description?: string
  icon?: LucideIcon
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  size?: number
  itemCount?: number
  disabled?: boolean
  className?: string
}

export function CategoryCheckbox({
  label,
  description,
  icon: Icon,
  checked,
  indeterminate,
  onChange,
  size,
  itemCount,
  disabled,
  className
}: CategoryCheckboxProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3.5 rounded-xl px-3.5 py-3 transition-colors',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      style={{ background: checked ? 'rgba(245,158,11,0.04)' : 'transparent' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)' }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.04)' : 'transparent' }}
    >
      <div className="relative flex items-center">
        <input
          type="checkbox"
          checked={checked}
          ref={(el) => { if (el) el.indeterminate = indeterminate ?? false }}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="peer sr-only"
        />
        <div
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] transition-all"
          style={{
            background: checked || indeterminate ? '#f59e0b' : 'rgba(255,255,255,0.06)',
            border: checked || indeterminate ? 'none' : '1.5px solid rgba(255,255,255,0.12)'
          }}
        >
          {checked && (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6l2.5 2.5 4.5-5" stroke="#1a0a00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {indeterminate && !checked && (
            <div className="h-[2px] w-2 rounded-full" style={{ background: '#1a0a00' }} />
          )}
        </div>
      </div>

      {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: '#52525e' }} strokeWidth={1.8} />}

      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium text-zinc-300">{label}</span>
        {description && <p className="text-[11px]" style={{ color: '#4e4e56' }}>{description}</p>}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {itemCount !== undefined && (
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[11px]"
            style={{ background: 'rgba(255,255,255,0.04)', color: '#6e6e76' }}
          >
            {formatNumber(itemCount)}
          </span>
        )}
        {size !== undefined && (
          <span className="font-mono text-[11px] font-medium text-zinc-400">
            {formatBytes(size)}
          </span>
        )}
      </div>
    </label>
  )
}
