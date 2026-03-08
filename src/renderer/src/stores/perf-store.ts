import { create } from 'zustand'
import type { PerfSystemInfo, PerfSnapshot, PerfProcess } from '@shared/types'

const MAX_HISTORY = 900 // 15 minutes at 1s intervals

interface PerfState {
  systemInfo: PerfSystemInfo | null
  currentSnapshot: PerfSnapshot | null
  history: PerfSnapshot[]
  processList: PerfProcess[]
  processCount: number
  isMonitoring: boolean
  timeRange: '60s' | '5m' | '15m'
  processFilter: string
  processSortColumn: 'cpuPercent' | 'memBytes' | 'name' | 'pid'
  processSortDir: 'asc' | 'desc'

  setSystemInfo: (info: PerfSystemInfo) => void
  pushSnapshot: (snap: PerfSnapshot) => void
  setProcessList: (processes: PerfProcess[], totalCount: number) => void
  setMonitoring: (on: boolean) => void
  setTimeRange: (range: '60s' | '5m' | '15m') => void
  setProcessFilter: (filter: string) => void
  setProcessSort: (column: PerfState['processSortColumn']) => void
  reset: () => void
}

export const usePerfStore = create<PerfState>((set, get) => ({
  systemInfo: null,
  currentSnapshot: null,
  history: [],
  processList: [],
  processCount: 0,
  isMonitoring: false,
  timeRange: '60s',
  processFilter: '',
  processSortColumn: 'cpuPercent',
  processSortDir: 'desc',

  setSystemInfo: (info) => set({ systemInfo: info }),

  pushSnapshot: (snap) => {
    const history = get().history
    const next = history.length >= MAX_HISTORY
      ? [...history.slice(history.length - MAX_HISTORY + 1), snap]
      : [...history, snap]
    set({ currentSnapshot: snap, history: next })
  },

  setProcessList: (processes, totalCount) =>
    set({ processList: processes, processCount: totalCount }),

  setMonitoring: (on) => set({ isMonitoring: on }),

  setTimeRange: (range) => set({ timeRange: range }),

  setProcessFilter: (filter) => set({ processFilter: filter }),

  setProcessSort: (column) => {
    const { processSortColumn, processSortDir } = get()
    if (processSortColumn === column) {
      set({ processSortDir: processSortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ processSortColumn: column, processSortDir: 'desc' })
    }
  },

  reset: () =>
    set({
      currentSnapshot: null,
      history: [],
      processList: [],
      processCount: 0,
      isMonitoring: false,
      processFilter: ''
    })
}))
