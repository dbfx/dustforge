import { join } from 'path'
import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { app } from 'electron'

let _daemonMode = false

/** When enabled, all log lines are also written to stdout (for daemon/journald) */
export function setDaemonMode(enabled: boolean): void {
  _daemonMode = enabled
}

const LOG_DIR = join(app.getPath('userData'), 'logs')
const LOG_FILE = join(LOG_DIR, 'dustforge.log')
const LOG_FILE_OLD = join(LOG_DIR, 'dustforge.old.log')
const CLOUD_LOG_FILE = join(LOG_DIR, 'cloud-agent.log')
const CLOUD_LOG_FILE_OLD = join(LOG_DIR, 'cloud-agent.old.log')
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB

try {
  mkdirSync(LOG_DIR, { recursive: true })
} catch {
  // Ignore
}

function rotateIfNeeded(file: string, oldFile: string): void {
  try {
    const stats = statSync(file)
    if (stats.size > MAX_LOG_SIZE) {
      try { unlinkSync(oldFile) } catch { /* ignore */ }
      renameSync(file, oldFile)
    }
  } catch {
    // File doesn't exist yet, no rotation needed
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

export function logInfo(message: string): void {
  const line = `[${timestamp()}] INFO: ${message}\n`
  try {
    rotateIfNeeded(LOG_FILE, LOG_FILE_OLD)
    appendFileSync(LOG_FILE, line)
  } catch {
    // Ignore
  }
}

export function logError(message: string, error?: unknown): void {
  const errStr = error instanceof Error ? error.message : String(error ?? '')
  const line = `[${timestamp()}] ERROR: ${message} ${errStr}\n`
  try {
    rotateIfNeeded(LOG_FILE, LOG_FILE_OLD)
    appendFileSync(LOG_FILE, line)
  } catch {
    // Ignore
  }
}

export function logDebug(message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `[${timestamp()}] DEBUG: ${message}${extra}\n`
  try {
    rotateIfNeeded(LOG_FILE, LOG_FILE_OLD)
    appendFileSync(LOG_FILE, line)
  } catch {
    // Ignore
  }
}

export function cloudLog(level: 'INFO' | 'ERROR' | 'DEBUG', message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `[${timestamp()}] ${level}: ${message}${extra}\n`
  try {
    rotateIfNeeded(CLOUD_LOG_FILE, CLOUD_LOG_FILE_OLD)
    appendFileSync(CLOUD_LOG_FILE, line)
  } catch {
    // Ignore
  }
  // Also write to main log for INFO/ERROR
  if (level === 'ERROR') logError(message)
  else if (level === 'INFO') logInfo(message)
  // Mirror to stdout in daemon mode (for journald / foreground use)
  if (_daemonMode) {
    process.stdout.write(`[${timestamp()}] [cloud:${level}] ${message}${extra}\n`)
  }
}
