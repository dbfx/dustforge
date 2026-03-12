import { create } from 'zustand'
import type { CloudActionEntry } from '@shared/types'

interface CloudHistoryState {
  entries: CloudActionEntry[]
  loaded: boolean
  load: () => Promise<void>
  clear: () => Promise<void>
}

export const useCloudHistoryStore = create<CloudHistoryState>((set) => ({
  entries: [],
  loaded: false,

  load: async () => {
    try {
      const entries = await window.dustforge.cloudHistoryGet()
      set({ entries, loaded: true })
    } catch {
      set({ entries: [], loaded: true })
    }
  },

  clear: async () => {
    try {
      await window.dustforge.cloudHistoryClear()
      set({ entries: [] })
    } catch {
      // Silent fail
    }
  }
}))
