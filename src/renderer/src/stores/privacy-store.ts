import { create } from 'zustand'
import type { PrivacyShieldState, PrivacyApplyResult, PrivacyScanProgress } from '@shared/types'

interface PrivacyStoreState {
  state: PrivacyShieldState | null
  status: 'idle' | 'scanning' | 'applying' | 'done'
  applyResult: PrivacyApplyResult | null
  expandedCategories: Set<string>
  progress: PrivacyScanProgress | null

  setState: (state: PrivacyShieldState | null) => void
  setStatus: (status: 'idle' | 'scanning' | 'applying' | 'done') => void
  setApplyResult: (result: PrivacyApplyResult | null) => void
  setExpandedCategories: (categories: Set<string>) => void
  toggleCategory: (id: string) => void
  setProgress: (progress: PrivacyScanProgress | null) => void
  reset: () => void
}

export const usePrivacyStore = create<PrivacyStoreState>((set) => ({
  state: null,
  status: 'idle',
  applyResult: null,
  expandedCategories: new Set<string>(),
  progress: null,

  setState: (state) => set({ state }),
  setStatus: (status) => set({ status }),
  setApplyResult: (applyResult) => set({ applyResult }),
  setExpandedCategories: (expandedCategories) => set({ expandedCategories }),
  toggleCategory: (id) =>
    set((s) => {
      const next = new Set(s.expandedCategories)
      next.has(id) ? next.delete(id) : next.add(id)
      return { expandedCategories: next }
    }),
  setProgress: (progress) => set({ progress }),
  reset: () =>
    set({
      state: null,
      status: 'idle',
      applyResult: null,
      expandedCategories: new Set<string>(),
      progress: null
    })
}))
