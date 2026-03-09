import { create } from 'zustand'
import type {
  WindowsService,
  ServiceScanProgress,
  ServiceApplyResult,
  ServiceSafety,
  ServiceCategory
} from '@shared/types'

interface ServiceState {
  services: WindowsService[]
  scanning: boolean
  applying: boolean
  scanProgress: ServiceScanProgress | null
  applyResult: ServiceApplyResult | null
  error: string | null
  hasScanned: boolean

  // Filters
  searchQuery: string
  safetyFilter: 'all' | ServiceSafety
  categoryFilter: 'all' | ServiceCategory
  statusFilter: 'all' | 'running' | 'stopped' | 'disabled'

  // Actions
  setServices: (services: WindowsService[]) => void
  setScanning: (scanning: boolean) => void
  setApplying: (applying: boolean) => void
  setScanProgress: (progress: ServiceScanProgress | null) => void
  setApplyResult: (result: ServiceApplyResult | null) => void
  setError: (error: string | null) => void
  setHasScanned: (hasScanned: boolean) => void

  setSearchQuery: (query: string) => void
  setSafetyFilter: (filter: 'all' | ServiceSafety) => void
  setCategoryFilter: (filter: 'all' | ServiceCategory) => void
  setStatusFilter: (filter: 'all' | 'running' | 'stopped' | 'disabled') => void

  toggleService: (name: string) => void
  selectRecommended: () => void
  deselectAll: () => void
  reset: () => void
}

export const useServiceStore = create<ServiceState>((set) => ({
  services: [],
  scanning: false,
  applying: false,
  scanProgress: null,
  applyResult: null,
  error: null,
  hasScanned: false,

  searchQuery: '',
  safetyFilter: 'all',
  categoryFilter: 'all',
  statusFilter: 'all',

  setServices: (services) => set({ services }),
  setScanning: (scanning) => set({ scanning }),
  setApplying: (applying) => set({ applying }),
  setScanProgress: (scanProgress) => set({ scanProgress }),
  setApplyResult: (applyResult) => set({ applyResult }),
  setError: (error) => set({ error }),
  setHasScanned: (hasScanned) => set({ hasScanned }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSafetyFilter: (safetyFilter) => set({ safetyFilter }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),

  toggleService: (name) =>
    set((s) => ({
      services: s.services.map((svc) =>
        svc.name === name && svc.safety !== 'unsafe'
          ? { ...svc, selected: !svc.selected }
          : svc
      )
    })),

  selectRecommended: () =>
    set((s) => ({
      services: s.services.map((svc) =>
        svc.safety === 'safe' && svc.startType !== 'Disabled'
          ? { ...svc, selected: true }
          : { ...svc, selected: false }
      )
    })),

  deselectAll: () =>
    set((s) => ({
      services: s.services.map((svc) => ({ ...svc, selected: false }))
    })),

  reset: () =>
    set({
      services: [],
      scanning: false,
      applying: false,
      scanProgress: null,
      applyResult: null,
      error: null,
      hasScanned: false,
      searchQuery: '',
      safetyFilter: 'all',
      categoryFilter: 'all',
      statusFilter: 'all'
    })
}))
