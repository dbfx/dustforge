import { Sidebar } from './Sidebar'
import { AdminBanner } from './AdminBanner'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0c0c0e' }}>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Invisible drag region for moving window (top edge) */}
        <div className="drag-region h-8 shrink-0" />
        {/* Window controls float in top right */}
        <WindowControls />
        <AdminBanner />
        <main className="flex-1 overflow-y-auto px-10 pb-10 pt-2">
          {children}
        </main>
      </div>
    </div>
  )
}

function WindowControls() {
  return (
    <div className="no-drag fixed right-0 top-0 z-50 flex">
      <button
        onClick={() => window.dustforge.windowMinimize()}
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.dustforge.windowMaximize()}
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.dustforge.windowClose()}
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-red-500 hover:text-white"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  )
}
