/**
 * Runtime validation helpers for IPC inputs from the renderer process.
 * These guard against malformed or malicious data crossing the IPC boundary.
 */

import { app } from 'electron'
import type { ScanHistoryEntry } from '../../shared/types'

/** Validate that a partial settings object only contains expected keys and safe values */
export function validateSettingsPartial(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  const allowedTopKeys = new Set([
    'minimizeToTray', 'showNotificationOnComplete', 'runAtStartup',
    'autoUpdate', 'autoRestart', 'updateCheckIntervalHours',
    'cleaner', 'exclusions', 'schedule', 'cloud'
  ])

  for (const key of Object.keys(obj)) {
    if (!allowedTopKeys.has(key)) return null
  }

  // Validate boolean fields have correct types
  const boolKeys = ['minimizeToTray', 'showNotificationOnComplete', 'runAtStartup', 'autoUpdate', 'autoRestart'] as const
  for (const bk of boolKeys) {
    if (bk in obj && obj[bk] !== undefined && typeof obj[bk] !== 'boolean') return null
  }

  // Validate updateCheckIntervalHours is a reasonable number
  if ('updateCheckIntervalHours' in obj && obj.updateCheckIntervalHours !== undefined) {
    if (typeof obj.updateCheckIntervalHours !== 'number' || obj.updateCheckIntervalHours < 1 || obj.updateCheckIntervalHours > 168) return null
  }

  // Validate exclusions is an array of safe strings if present
  if ('exclusions' in obj && obj.exclusions !== undefined) {
    if (!Array.isArray(obj.exclusions)) return null
    if (!obj.exclusions.every((v: unknown) => typeof v === 'string')) return null
    // Limit number of exclusions and individual length
    if (obj.exclusions.length > 200) return null
    if (obj.exclusions.some((v: string) => v.length > 500 || v.length === 0)) return null
    // Block path traversal sequences and UNC paths in exclusions
    if (obj.exclusions.some((v: string) => v.includes('..') || v.startsWith('\\\\'))) return null
  }

  // Validate schedule has expected shape if present
  if ('schedule' in obj && obj.schedule !== undefined) {
    const s = obj.schedule as Record<string, unknown>
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
    const allowedScheduleKeys = new Set(['enabled', 'frequency', 'day', 'hour'])
    for (const key of Object.keys(s)) {
      if (!allowedScheduleKeys.has(key)) return null
    }
    if ('enabled' in s && typeof s.enabled !== 'boolean') return null
    if ('hour' in s && (typeof s.hour !== 'number' || s.hour < 0 || s.hour > 23)) return null
    if ('day' in s && (typeof s.day !== 'number' || s.day < 0 || s.day > 6)) return null
    if ('frequency' in s && !['daily', 'weekly', 'monthly'].includes(s.frequency as string)) return null
  }

  // Validate cleaner has expected shape if present
  if ('cleaner' in obj && obj.cleaner !== undefined) {
    const c = obj.cleaner as Record<string, unknown>
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
    const allowedCleanerKeys = new Set(['skipRecentMinutes', 'secureDelete', 'closeBrowsersBeforeClean', 'createRestorePoint'])
    for (const key of Object.keys(c)) {
      if (!allowedCleanerKeys.has(key)) return null
    }
    if ('skipRecentMinutes' in c && (typeof c.skipRecentMinutes !== 'number' || c.skipRecentMinutes < 0 || c.skipRecentMinutes > 525600)) return null
    if ('secureDelete' in c && typeof c.secureDelete !== 'boolean') return null
    if ('closeBrowsersBeforeClean' in c && typeof c.closeBrowsersBeforeClean !== 'boolean') return null
    if ('createRestorePoint' in c && typeof c.createRestorePoint !== 'boolean') return null
  }

  // Validate cloud has expected shape if present
  if ('cloud' in obj && obj.cloud !== undefined) {
    const c = obj.cloud as Record<string, unknown>
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
    const allowedCloudKeys = new Set(['apiKey', 'serverUrl', 'telemetryIntervalSec', 'shareDiskHealth', 'shareProcessList', 'shareThreatMonitor', 'allowRemotePower', 'allowRemoteCleanup', 'allowRemoteInstalls', 'allowRemoteConfig'])
    for (const key of Object.keys(c)) {
      if (!allowedCloudKeys.has(key)) return null
    }
    if ('apiKey' in c && (typeof c.apiKey !== 'string' || c.apiKey.length > 200)) return null
    if ('serverUrl' in c) {
      if (typeof c.serverUrl !== 'string' || c.serverUrl.length > 500) return null
      // SSRF protection: only allow http(s) URLs pointing to non-private hosts
      try {
        const url = new URL(c.serverUrl)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
        const host = url.hostname.toLowerCase()
        // Block loopback, link-local, and private ranges (skip in dev builds)
        if (app.isPackaged) {
          if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return null
          if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return null
          if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null
          if (host === '0.0.0.0') return null
          // Block IPv6 private/loopback ranges: fc00::/7 (unique local), fe80::/10 (link-local), ::ffff:127.x (mapped loopback)
          const bare = host.replace(/^\[|\]$/g, '')
          if (bare.startsWith('fc') || bare.startsWith('fd')) return null
          if (bare.startsWith('fe8') || bare.startsWith('fe9') || bare.startsWith('fea') || bare.startsWith('feb')) return null
          if (bare.startsWith('::ffff:127.') || bare.startsWith('::ffff:10.') || bare.startsWith('::ffff:192.168.') || bare.startsWith('::ffff:169.254.')) return null
          if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(bare)) return null
        }
      } catch {
        return null
      }
    }
    if ('telemetryIntervalSec' in c && (typeof c.telemetryIntervalSec !== 'number' || c.telemetryIntervalSec < 10 || c.telemetryIntervalSec > 3600)) return null
    if ('shareDiskHealth' in c && typeof c.shareDiskHealth !== 'boolean') return null
    if ('shareProcessList' in c && typeof c.shareProcessList !== 'boolean') return null
  }

  return obj
}

/** Validate a scan history entry has the expected shape and reasonable size */
export function validateHistoryEntry(input: unknown): ScanHistoryEntry | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  if (typeof obj.id !== 'string' || obj.id.length > 100) return null
  if (!['cleaner', 'registry', 'debloater', 'network', 'drivers', 'malware', 'privacy', 'startup', 'services', 'software-update'].includes(obj.type as string)) return null
  if (typeof obj.timestamp !== 'string' || obj.timestamp.length > 50) return null
  if (typeof obj.duration !== 'number' || obj.duration < 0) return null
  if (typeof obj.totalItemsFound !== 'number') return null
  if (typeof obj.totalItemsCleaned !== 'number') return null
  if (typeof obj.totalItemsSkipped !== 'number') return null
  if (typeof obj.totalSpaceSaved !== 'number') return null
  if (typeof obj.errorCount !== 'number') return null
  if (!Array.isArray(obj.categories)) return null
  // Limit categories array size to prevent disk-fill attacks
  if (obj.categories.length > 50) return null

  return obj as unknown as ScanHistoryEntry
}

