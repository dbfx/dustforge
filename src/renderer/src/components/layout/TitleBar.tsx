import { Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TitleBar() {
  return (
    <div className="drag-region flex h-9 items-center justify-between border-b border-zinc-800/50 bg-bg-base px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/20">
          <span className="text-xs font-bold text-accent">D</span>
        </div>
        <span className="text-sm font-medium text-zinc-400">DustForge</span>
      </div>

      <div className="no-drag flex items-center">
        <WindowButton onClick={() => window.dustforge.windowMinimize()} aria-label="Minimize">
          <Minus className="h-3.5 w-3.5" />
        </WindowButton>
        <WindowButton onClick={() => window.dustforge.windowMaximize()} aria-label="Maximize">
          <Square className="h-3 w-3" />
        </WindowButton>
        <WindowButton
          onClick={() => window.dustforge.windowClose()}
          aria-label="Close"
          variant="close"
        >
          <X className="h-3.5 w-3.5" />
        </WindowButton>
      </div>
    </div>
  )
}

function WindowButton({
  children,
  onClick,
  variant,
  ...props
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'close'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-9 w-11 items-center justify-center text-zinc-400 transition-colors',
        variant === 'close'
          ? 'hover:bg-danger hover:text-white'
          : 'hover:bg-zinc-800 hover:text-zinc-200'
      )}
      {...props}
    >
      {children}
    </button>
  )
}
