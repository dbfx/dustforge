import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { CloudActionEntry } from '../../shared/types'

const MAX_ENTRIES = 200

let _dataDir: string | null = null
let _filePath: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'DustForge-Dev')
  }
  return _dataDir
}

function getFilePath(): string {
  if (!_filePath) {
    _filePath = join(getDataDir(), 'cloud-history.json')
  }
  return _filePath
}

function ensureDir(): void {
  const dir = getDataDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function getCloudHistory(): CloudActionEntry[] {
  try {
    if (existsSync(getFilePath())) {
      const raw = readFileSync(getFilePath(), 'utf-8')
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : []
    }
  } catch {
    // Corrupt file
  }
  return []
}

export function addCloudHistoryEntry(entry: CloudActionEntry): void {
  ensureDir()
  const history = getCloudHistory()
  history.unshift(entry)
  if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES
  writeFileSync(getFilePath(), JSON.stringify(history, null, 2), 'utf-8')
}

export function clearCloudHistory(): void {
  ensureDir()
  writeFileSync(getFilePath(), '[]', 'utf-8')
}
