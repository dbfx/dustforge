import { create } from 'zustand'
import type { RegistryEntry } from '@shared/types'

interface FixResult {
  fixed: number
  failed: number
  failures: { issue: string; reason: string }[]
}

interface RegistryState {
  entries: RegistryEntry[]
  scanning: boolean
  scanned: boolean
  fixing: boolean
  fixProgress: { current: number; total: number; currentEntry: string } | null
  expandedCards: Set<number>
  fixResult: FixResult | null
  showFailures: boolean
  error: string | null

  setEntries: (entries: RegistryEntry[]) => void
  setScanning: (scanning: boolean) => void
  setScanned: (scanned: boolean) => void
  setFixing: (fixing: boolean) => void
  setFixProgress: (progress: { current: number; total: number; currentEntry: string } | null) => void
  toggleCardExpand: (cardIndex: number) => void
  setFixResult: (result: FixResult | null) => void
  setShowFailures: (show: boolean) => void
  setError: (error: string | null) => void
  toggleEntry: (id: string) => void
  toggleCardAll: (types: string[]) => void
  reset: () => void
}

export const useRegistryStore = create<RegistryState>((set) => ({
  entries: [],
  scanning: false,
  scanned: false,
  fixing: false,
  fixProgress: null,
  expandedCards: new Set<number>(),
  fixResult: null,
  showFailures: false,
  error: null,

  setEntries: (entries) => set({ entries }),
  setScanning: (scanning) => set({ scanning }),
  setScanned: (scanned) => set({ scanned }),
  setFixing: (fixing) => set({ fixing }),
  setFixProgress: (fixProgress) => set({ fixProgress }),
  toggleCardExpand: (cardIndex) =>
    set((s) => {
      const next = new Set(s.expandedCards)
      next.has(cardIndex) ? next.delete(cardIndex) : next.add(cardIndex)
      return { expandedCards: next }
    }),
  setFixResult: (fixResult) => set({ fixResult }),
  setShowFailures: (showFailures) => set({ showFailures }),
  setError: (error) => set({ error }),
  toggleEntry: (id) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e))
    })),
  toggleCardAll: (types) =>
    set((s) => {
      const cardEntries = s.entries.filter((e) => types.includes(e.type))
      const allSelected = cardEntries.length > 0 && cardEntries.every((e) => e.selected)
      return {
        entries: s.entries.map((e) =>
          types.includes(e.type) ? { ...e, selected: !allSelected } : e
        )
      }
    }),
  reset: () =>
    set({
      entries: [],
      scanning: false,
      scanned: false,
      fixing: false,
      fixProgress: null,
      fixResult: null,
      showFailures: false,
      error: null
    })
}))
