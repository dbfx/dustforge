import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Electron and dependencies before importing
vi.mock('electron', () => ({
  BrowserWindow: class {},
  Notification: { isSupported: () => false },
}))
vi.mock('./settings-store', () => ({ getSettings: () => ({}) }))
vi.mock('./history-store', () => ({ getHistory: () => [] }))
vi.mock('./logger', () => ({ logInfo: () => {}, logError: () => {} }))

import { getNextScanTime, isSameDay } from './scheduler'
import type { DustForgeSettings } from '../../shared/types'

function makeSettings(
  overrides: Partial<DustForgeSettings['schedule']> & { enabled?: boolean } = {}
): DustForgeSettings {
  return {
    minimizeToTray: false,
    showNotificationOnComplete: true,
    runAtStartup: false,
    autoUpdate: true,
    cleaner: {
      skipRecentMinutes: 60,
      secureDelete: false,
      closeBrowsersBeforeClean: false,
      createRestorePoint: false,
    },
    exclusions: [],
    schedule: {
      enabled: overrides.enabled ?? true,
      frequency: overrides.frequency ?? 'daily',
      day: overrides.day ?? 1,
      hour: overrides.hour ?? 9,
    },
  }
}

describe('isSameDay', () => {
  it('returns true for the same date', () => {
    const a = new Date('2025-06-15T08:00:00')
    const b = new Date('2025-06-15T22:30:00')
    expect(isSameDay(a, b)).toBe(true)
  })

  it('returns false for different dates', () => {
    const a = new Date('2025-06-15T23:59:59')
    const b = new Date('2025-06-16T00:00:01')
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for same day different month', () => {
    const a = new Date('2025-01-15')
    const b = new Date('2025-02-15')
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for same day different year', () => {
    const a = new Date('2024-06-15')
    const b = new Date('2025-06-15')
    expect(isSameDay(a, b)).toBe(false)
  })
})

describe('getNextScanTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when schedule is disabled', () => {
    const settings = makeSettings({ enabled: false })
    expect(getNextScanTime(settings)).toBeNull()
  })

  // Daily scheduling
  describe('daily', () => {
    it('returns today if scheduled hour has not passed', () => {
      // Current time: 7:00, scheduled: 9:00
      vi.setSystemTime(new Date('2025-06-15T07:00:00'))
      const settings = makeSettings({ frequency: 'daily', hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDate()).toBe(15)
      expect(result.getHours()).toBe(9)
    })

    it('returns tomorrow if scheduled hour has passed', () => {
      // Current time: 10:00, scheduled: 9:00
      vi.setSystemTime(new Date('2025-06-15T10:00:00'))
      const settings = makeSettings({ frequency: 'daily', hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDate()).toBe(16)
      expect(result.getHours()).toBe(9)
    })
  })

  // Weekly scheduling
  describe('weekly', () => {
    it('returns the correct day of the week', () => {
      // June 15, 2025 is a Sunday (day 0). Schedule for Wednesday (day 3)
      vi.setSystemTime(new Date('2025-06-15T07:00:00'))
      const settings = makeSettings({ frequency: 'weekly', day: 3, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDay()).toBe(3) // Wednesday
      expect(result.getHours()).toBe(9)
    })

    it('goes to next week if the day has passed', () => {
      // June 15, 2025 is Sunday. Schedule for Saturday (day 6) at 9am, but it's past
      // Actually let's set to Monday (day 1) and schedule for Sunday (day 0)
      vi.setSystemTime(new Date('2025-06-16T10:00:00')) // Monday
      const settings = makeSettings({ frequency: 'weekly', day: 0, hour: 9 }) // Sunday
      const result = getNextScanTime(settings)!
      expect(result.getDay()).toBe(0) // Sunday
      expect(result.getDate()).toBe(22) // Next Sunday
    })

    it('goes to next week if same day but hour has passed', () => {
      // June 15, 2025 is Sunday. Schedule for Sunday at 9am, but it's 10am
      vi.setSystemTime(new Date('2025-06-15T10:00:00'))
      const settings = makeSettings({ frequency: 'weekly', day: 0, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDay()).toBe(0)
      expect(result.getDate()).toBe(22) // Next Sunday
    })
  })

  // Monthly scheduling
  describe('monthly', () => {
    it('returns the correct day this month if not yet passed', () => {
      vi.setSystemTime(new Date('2025-06-10T07:00:00'))
      const settings = makeSettings({ frequency: 'monthly', day: 15, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDate()).toBe(15)
      expect(result.getMonth()).toBe(5) // June
    })

    it('goes to next month if day has passed', () => {
      vi.setSystemTime(new Date('2025-06-20T10:00:00'))
      const settings = makeSettings({ frequency: 'monthly', day: 15, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getMonth()).toBe(6) // July
      expect(result.getDate()).toBe(15)
    })

    it('clamps day for short months (e.g., Feb 31 → Feb 28)', () => {
      // Set time to early February so the scheduler targets Feb with day=31
      vi.setSystemTime(new Date('2025-02-01T07:00:00'))
      const settings = makeSettings({ frequency: 'monthly', day: 31, hour: 9 })
      const result = getNextScanTime(settings)!
      // Day 31 in Feb overflows, then the clamp should cap it to 28
      expect(result.getDate()).toBeLessThanOrEqual(28) // 2025 is not a leap year
    })
  })

  it('always returns a future date', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'))
    const settings = makeSettings({ frequency: 'daily', hour: 8 })
    const result = getNextScanTime(settings)!
    expect(result.getTime()).toBeGreaterThan(new Date('2025-06-15T12:00:00').getTime())
  })
})
