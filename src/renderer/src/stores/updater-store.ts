import { create } from 'zustand'
import type { UpdatableApp, UpToDateApp, UpdateProgress, UpdateResult } from '../../../shared/types'

type SortField = 'name' | 'severity' | 'source'
type SeverityFilter = 'all' | 'major' | 'minor' | 'patch'

interface SoftwareUpdaterState {
  apps: UpdatableApp[]
  upToDate: UpToDateApp[]
  loading: boolean
  updating: boolean
  progress: UpdateProgress | null
  updateResult: UpdateResult | null
  error: string | null
  hasChecked: boolean
  wingetAvailable: boolean
  searchQuery: string
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  severityFilter: SeverityFilter

  setApps: (apps: UpdatableApp[]) => void
  setUpToDate: (apps: UpToDateApp[]) => void
  setLoading: (loading: boolean) => void
  setUpdating: (updating: boolean) => void
  setProgress: (progress: UpdateProgress | null) => void
  setUpdateResult: (result: UpdateResult | null) => void
  setError: (error: string | null) => void
  setHasChecked: (checked: boolean) => void
  setWingetAvailable: (available: boolean) => void
  setSearchQuery: (query: string) => void
  setSortField: (field: SortField) => void
  setSortDirection: (dir: 'asc' | 'desc') => void
  setSeverityFilter: (filter: SeverityFilter) => void
  toggleAppSelected: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  removeApps: (ids: string[]) => void
  reset: () => void
}

const severityOrder = { major: 0, minor: 1, patch: 2, unknown: 3 }

export const useUpdaterStore = create<SoftwareUpdaterState>((set) => ({
  apps: [],
  upToDate: [],
  loading: false,
  updating: false,
  progress: null,
  updateResult: null,
  error: null,
  hasChecked: false,
  wingetAvailable: true,
  searchQuery: '',
  sortField: 'name',
  sortDirection: 'asc',
  severityFilter: 'all',

  setApps: (apps) => set({ apps }),
  setUpToDate: (upToDate) => set({ upToDate }),
  setLoading: (loading) => set({ loading }),
  setUpdating: (updating) => set({ updating }),
  setProgress: (progress) => set({ progress }),
  setUpdateResult: (updateResult) => set({ updateResult }),
  setError: (error) => set({ error }),
  setHasChecked: (hasChecked) => set({ hasChecked }),
  setWingetAvailable: (wingetAvailable) => set({ wingetAvailable }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortField: (sortField) =>
    set((state) => ({
      sortField,
      sortDirection: sortField === 'severity' ? 'asc' : state.sortDirection,
    })),
  setSortDirection: (sortDirection) => set({ sortDirection }),
  setSeverityFilter: (severityFilter) => set({ severityFilter }),
  toggleAppSelected: (id) =>
    set((state) => ({
      apps: state.apps.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)),
    })),
  selectAll: () =>
    set((state) => ({
      apps: state.apps.map((a) => ({ ...a, selected: true })),
    })),
  deselectAll: () =>
    set((state) => ({
      apps: state.apps.map((a) => ({ ...a, selected: false })),
    })),
  removeApps: (ids) =>
    set((state) => ({
      apps: state.apps.filter((a) => !ids.includes(a.id)),
    })),
  reset: () =>
    set({
      apps: [],
      upToDate: [],
      loading: false,
      updating: false,
      progress: null,
      updateResult: null,
      error: null,
      hasChecked: false,
      wingetAvailable: true,
      searchQuery: '',
      sortField: 'name',
      sortDirection: 'asc',
      severityFilter: 'all',
    }),
}))

export { severityOrder }
