import { create } from 'zustand'
import type { InstalledProgram, UninstallProgress, UninstallResult } from '../../../shared/types'

type SortField = 'displayName' | 'estimatedSize' | 'installDate' | 'publisher'
type FilterMode = 'all' | 'unused'

interface UninstallerState {
  programs: InstalledProgram[]
  loading: boolean
  uninstalling: boolean
  progress: UninstallProgress | null
  uninstallResult: UninstallResult | null
  error: string | null
  hasLoaded: boolean
  searchQuery: string
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  filterMode: FilterMode

  setPrograms: (programs: InstalledProgram[]) => void
  setLoading: (loading: boolean) => void
  setUninstalling: (uninstalling: boolean) => void
  setProgress: (progress: UninstallProgress | null) => void
  setUninstallResult: (result: UninstallResult | null) => void
  setError: (error: string | null) => void
  setHasLoaded: (loaded: boolean) => void
  setSearchQuery: (query: string) => void
  setSortField: (field: SortField) => void
  setSortDirection: (dir: 'asc' | 'desc') => void
  setFilterMode: (mode: FilterMode) => void
  removeProgram: (id: string) => void
  reset: () => void
}

/** Programs not seen in Prefetch for 90+ days are considered unused */
export const UNUSED_THRESHOLD_DAYS = 90

export const useUninstallerStore = create<UninstallerState>((set) => ({
  programs: [],
  loading: false,
  uninstalling: false,
  progress: null,
  uninstallResult: null,
  error: null,
  hasLoaded: false,
  searchQuery: '',
  sortField: 'displayName',
  sortDirection: 'asc',
  filterMode: 'all',

  setPrograms: (programs) => set({ programs }),
  setLoading: (loading) => set({ loading }),
  setUninstalling: (uninstalling) => set({ uninstalling }),
  setProgress: (progress) => set({ progress }),
  setUninstallResult: (uninstallResult) => set({ uninstallResult }),
  setError: (error) => set({ error }),
  setHasLoaded: (hasLoaded) => set({ hasLoaded }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortField: (sortField) => set({ sortField }),
  setSortDirection: (sortDirection) => set({ sortDirection }),
  setFilterMode: (filterMode) => set({ filterMode }),
  removeProgram: (id) =>
    set((state) => ({ programs: state.programs.filter((p) => p.id !== id) })),
  reset: () =>
    set({
      programs: [],
      loading: false,
      uninstalling: false,
      progress: null,
      uninstallResult: null,
      error: null,
      hasLoaded: false,
      searchQuery: '',
      sortField: 'displayName',
      sortDirection: 'asc',
      filterMode: 'all',
    }),
}))
