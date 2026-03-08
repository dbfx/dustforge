import { create } from 'zustand'
import type { StartupItem, StartupBootTrace } from '@shared/types'

interface StartupState {
  items: StartupItem[]
  loading: boolean
  sortBy: 'name' | 'impact'
  filterBy: 'all' | 'active' | 'disabled'
  error: string | null
  bootTrace: StartupBootTrace | null
  traceLoading: boolean
  deleteTarget: StartupItem | null

  setItems: (items: StartupItem[]) => void
  updateItem: (id: string, updates: Partial<StartupItem>) => void
  removeItem: (id: string) => void
  setLoading: (loading: boolean) => void
  setSortBy: (sortBy: 'name' | 'impact') => void
  setFilterBy: (filterBy: 'all' | 'active' | 'disabled') => void
  setError: (error: string | null) => void
  setBootTrace: (trace: StartupBootTrace | null) => void
  setTraceLoading: (loading: boolean) => void
  setDeleteTarget: (target: StartupItem | null) => void
  reset: () => void
}

export const useStartupStore = create<StartupState>((set) => ({
  items: [],
  loading: false,
  sortBy: 'impact',
  filterBy: 'all',
  error: null,
  bootTrace: null,
  traceLoading: false,
  deleteTarget: null,

  setItems: (items) => set({ items }),
  updateItem: (id, updates) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i))
    })),
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((i) => i.id !== id)
    })),
  setLoading: (loading) => set({ loading }),
  setSortBy: (sortBy) => set({ sortBy }),
  setFilterBy: (filterBy) => set({ filterBy }),
  setError: (error) => set({ error }),
  setBootTrace: (bootTrace) => set({ bootTrace }),
  setTraceLoading: (traceLoading) => set({ traceLoading }),
  setDeleteTarget: (deleteTarget) => set({ deleteTarget }),
  reset: () =>
    set({
      items: [],
      loading: false,
      error: null,
      bootTrace: null,
      traceLoading: false,
      deleteTarget: null
    })
}))
