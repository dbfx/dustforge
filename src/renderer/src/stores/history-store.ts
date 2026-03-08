import { create } from 'zustand'
import type { ScanHistoryEntry } from '@shared/types'

interface HistoryState {
  entries: ScanHistoryEntry[]
  loaded: boolean
  load: () => Promise<void>
  addEntry: (entry: ScanHistoryEntry) => Promise<void>
  clear: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,

  load: async () => {
    try {
      const entries = await window.dustforge.historyGet()
      set({ entries, loaded: true })
    } catch {
      set({ entries: [], loaded: true })
    }
  },

  addEntry: async (entry) => {
    try {
      await window.dustforge.historyAdd(entry)
      set((s) => ({ entries: [entry, ...s.entries].slice(0, 100) }))
    } catch {
      // Silent fail
    }
  },

  clear: async () => {
    try {
      await window.dustforge.historyClear()
      set({ entries: [] })
    } catch {
      // Silent fail
    }
  }
}))
