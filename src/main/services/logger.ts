import { join } from 'path'
import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { homedir } from 'os'

const LOG_DIR = join(homedir(), 'AppData', 'Local', 'DustForge', 'logs')
const LOG_FILE = join(LOG_DIR, 'dustforge.log')
const LOG_FILE_OLD = join(LOG_DIR, 'dustforge.old.log')
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB

try {
  mkdirSync(LOG_DIR, { recursive: true })
} catch {
  // Ignore
}

function rotateIfNeeded(): void {
  try {
    const stats = statSync(LOG_FILE)
    if (stats.size > MAX_LOG_SIZE) {
      try { unlinkSync(LOG_FILE_OLD) } catch { /* ignore */ }
      renameSync(LOG_FILE, LOG_FILE_OLD)
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
    rotateIfNeeded()
    appendFileSync(LOG_FILE, line)
  } catch {
    // Ignore
  }
}

export function logError(message: string, error?: unknown): void {
  const errStr = error instanceof Error ? error.message : String(error ?? '')
  const line = `[${timestamp()}] ERROR: ${message} ${errStr}\n`
  try {
    rotateIfNeeded()
    appendFileSync(LOG_FILE, line)
  } catch {
    // Ignore
  }
}
