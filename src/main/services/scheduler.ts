import { BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/channels'
import { getSettings } from './settings-store'
import { getHistory } from './history-store'
import { logInfo, logError } from './logger'
import type { DustForgeSettings } from '../../shared/types'

let schedulerTimer: ReturnType<typeof setInterval> | null = null

/**
 * Calculate the next scheduled scan time based on settings.
 */
export function getNextScanTime(settings: DustForgeSettings): Date | null {
  if (!settings.schedule.enabled) return null

  const now = new Date()
  const next = new Date()
  next.setHours(settings.schedule.hour, 0, 0, 0)

  switch (settings.schedule.frequency) {
    case 'daily':
      // If today's time has passed, schedule for tomorrow
      if (next <= now) next.setDate(next.getDate() + 1)
      break

    case 'weekly':
      // day = 0 (Sun) through 6 (Sat)
      next.setDate(next.getDate() + ((settings.schedule.day - next.getDay() + 7) % 7))
      if (next <= now) next.setDate(next.getDate() + 7)
      break

    case 'monthly':
      // day = 1-28 (day of month)
      next.setDate(settings.schedule.day)
      if (next <= now) next.setMonth(next.getMonth() + 1)
      // Clamp to valid day for the month
      const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      if (settings.schedule.day > maxDay) next.setDate(maxDay)
      break
  }

  return next
}

/**
 * Check if a scheduled scan is due and should run now.
 */
function isDue(settings: DustForgeSettings): boolean {
  if (!settings.schedule.enabled) return false

  const history = getHistory()
  const now = new Date()
  const lastScan = history.length > 0 ? new Date(history[0].timestamp) : null

  // Calculate the target time for today (or the scheduled day)
  const target = new Date()
  target.setHours(settings.schedule.hour, 0, 0, 0)

  switch (settings.schedule.frequency) {
    case 'daily':
      // Due if: current hour matches AND we haven't scanned today
      if (now.getHours() !== settings.schedule.hour) return false
      if (lastScan && isSameDay(lastScan, now)) return false
      return true

    case 'weekly':
      // Due if: correct day of week, correct hour, haven't scanned this week-slot
      if (now.getDay() !== settings.schedule.day) return false
      if (now.getHours() !== settings.schedule.hour) return false
      if (lastScan && isSameDay(lastScan, now)) return false
      return true

    case 'monthly':
      // Due if: correct day of month, correct hour, haven't scanned today
      if (now.getDate() !== settings.schedule.day) return false
      if (now.getHours() !== settings.schedule.hour) return false
      if (lastScan && isSameDay(lastScan, now)) return false
      return true
  }

  return false
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Trigger a scheduled scan by notifying the renderer process.
 * The renderer handles the actual scan orchestration.
 */
function triggerScheduledScan(mainWindow: BrowserWindow | null): void {
  logInfo('Scheduled scan triggered')

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.SCHEDULE_SCAN_TRIGGER)
  }

  // Show a system notification
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'DustForge - Scheduled Scan',
      body: 'Running a scheduled system scan...',
      silent: true
    })
    notification.show()
  }
}

/**
 * Send a notification when a scheduled scan completes.
 */
export function notifyScheduledScanComplete(totalSize: number, itemCount: number): void {
  if (!Notification.isSupported()) return
  const settings = getSettings()
  if (!settings.showNotificationOnComplete) return

  const sizeMB = (totalSize / (1024 * 1024)).toFixed(1)
  const notification = new Notification({
    title: 'DustForge - Scan Complete',
    body: `Found ${itemCount} items (${sizeMB} MB) that can be cleaned.`,
    silent: false
  })
  notification.show()
}

/**
 * Start the scheduler that checks every minute if a scan is due.
 */
export function startScheduler(getMainWindow: () => BrowserWindow | null): void {
  if (schedulerTimer) return

  logInfo('Scheduler started')

  // Check every 60 seconds
  schedulerTimer = setInterval(() => {
    try {
      const settings = getSettings()
      if (isDue(settings)) {
        triggerScheduledScan(getMainWindow())
      }
    } catch (err) {
      logInfo(`Scheduler error: ${err}`)
    }
  }, 60_000)

  // Also check immediately on startup (with a short delay to let the window load)
  setTimeout(() => {
    try {
      const settings = getSettings()
      if (isDue(settings)) {
        triggerScheduledScan(getMainWindow())
      }
    } catch (err) {
      logInfo(`Scheduler initial check error: ${err}`)
    }
  }, 5_000)
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
    logInfo('Scheduler stopped')
  }
}
