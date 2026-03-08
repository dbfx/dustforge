import { describe, it, expect, beforeEach } from 'vitest'
import { usePerfStore } from './perf-store'
import type { PerfSnapshot } from '@shared/types'

function makeSnapshot(timestamp: number): PerfSnapshot {
  return {
    timestamp,
    cpu: { overall: 50, perCore: [50] },
    memory: { usedBytes: 4e9, totalBytes: 8e9, cachedBytes: 1e9, percent: 50 },
    disk: { readBytesPerSec: 1e6, writeBytesPerSec: 5e5 },
    network: { rxBytesPerSec: 1e4, txBytesPerSec: 5e3 },
    uptime: 3600,
  }
}

describe('perf-store', () => {
  beforeEach(() => {
    usePerfStore.getState().reset()
  })

  it('starts with empty state', () => {
    const state = usePerfStore.getState()
    expect(state.history).toEqual([])
    expect(state.currentSnapshot).toBeNull()
    expect(state.isMonitoring).toBe(false)
  })

  it('pushSnapshot adds to history and sets current', () => {
    const snap = makeSnapshot(1)
    usePerfStore.getState().pushSnapshot(snap)
    const state = usePerfStore.getState()
    expect(state.currentSnapshot).toEqual(snap)
    expect(state.history).toHaveLength(1)
  })

  it('pushSnapshot caps history at MAX_HISTORY (900)', () => {
    for (let i = 0; i < 910; i++) {
      usePerfStore.getState().pushSnapshot(makeSnapshot(i))
    }
    const state = usePerfStore.getState()
    expect(state.history).toHaveLength(900)
    // Should keep the latest entries
    expect(state.history[state.history.length - 1].timestamp).toBe(909)
    // Oldest should have been evicted
    expect(state.history[0].timestamp).toBe(10)
  })

  it('setProcessSort toggles direction on same column', () => {
    expect(usePerfStore.getState().processSortDir).toBe('desc')
    usePerfStore.getState().setProcessSort('cpuPercent')
    expect(usePerfStore.getState().processSortDir).toBe('asc')
    usePerfStore.getState().setProcessSort('cpuPercent')
    expect(usePerfStore.getState().processSortDir).toBe('desc')
  })

  it('setProcessSort resets to desc on new column', () => {
    usePerfStore.getState().setProcessSort('cpuPercent') // asc
    usePerfStore.getState().setProcessSort('memBytes') // new column → desc
    const state = usePerfStore.getState()
    expect(state.processSortColumn).toBe('memBytes')
    expect(state.processSortDir).toBe('desc')
  })

  it('setTimeRange updates time range', () => {
    usePerfStore.getState().setTimeRange('15m')
    expect(usePerfStore.getState().timeRange).toBe('15m')
  })

  it('setProcessFilter updates filter', () => {
    usePerfStore.getState().setProcessFilter('chrome')
    expect(usePerfStore.getState().processFilter).toBe('chrome')
  })

  it('reset preserves systemInfo but clears monitoring data', () => {
    usePerfStore.getState().setSystemInfo({
      cpuModel: 'i7',
      cpuCores: 8,
      cpuThreads: 16,
      totalMemBytes: 16e9,
      osVersion: 'Win11',
      hostname: 'TEST',
    })
    usePerfStore.getState().pushSnapshot(makeSnapshot(1))
    usePerfStore.getState().setMonitoring(true)
    usePerfStore.getState().reset()
    const state = usePerfStore.getState()
    expect(state.systemInfo).not.toBeNull() // Preserved
    expect(state.history).toEqual([])
    expect(state.isMonitoring).toBe(false)
  })
})
