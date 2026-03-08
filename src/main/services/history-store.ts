import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ScanHistoryEntry } from '../../shared/types'

const MAX_HISTORY = 100

let _dataDir: string | null = null
let _historyPath: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'DustForge-Dev')
  }
  return _dataDir
}

function getHistoryPath(): string {
  if (!_historyPath) {
    _historyPath = join(getDataDir(), 'history.json')
  }
  return _historyPath
}

function ensureDir(): void {
  const dir = getDataDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function getHistory(): ScanHistoryEntry[] {
  try {
    if (existsSync(getHistoryPath())) {
      const raw = readFileSync(getHistoryPath(), 'utf-8')
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : []
    }
  } catch {
    // Corrupt file
  }
  return []
}

export function addHistoryEntry(entry: ScanHistoryEntry): void {
  ensureDir()
  const history = getHistory()
  history.unshift(entry)
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
  writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2), 'utf-8')
}

export function clearHistory(): void {
  ensureDir()
  writeFileSync(getHistoryPath(), '[]', 'utf-8')
}
