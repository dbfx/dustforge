import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DustForgeSettings, AppStats } from '../../shared/types'

let _dataDir: string | null = null
let _configPath: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'DustForge-Dev')
  }
  return _dataDir
}

function getConfigPath(): string {
  if (!_configPath) {
    _configPath = join(getDataDir(), 'config.json')
  }
  return _configPath
}

interface StoreData {
  settings: DustForgeSettings
  stats: AppStats
  onboardingComplete: boolean
}

const defaults: StoreData = {
  onboardingComplete: false,
  settings: {
    minimizeToTray: false,
    showNotificationOnComplete: true,
    runAtStartup: false,
    autoUpdate: true,
    cleaner: {
      skipRecentMinutes: 60,
      secureDelete: false,
      closeBrowsersBeforeClean: false,
      createRestorePoint: false
    },
    exclusions: [],
    schedule: {
      enabled: false,
      frequency: 'weekly',
      day: 1,
      hour: 9
    }
  },
  stats: {
    totalSpaceSaved: 0,
    totalFilesCleaned: 0,
    totalScans: 0,
    lastScanDate: null,
    recentActivity: []
  }
}

function ensureDir(): void {
  if (!existsSync(getDataDir())) {
    mkdirSync(getDataDir(), { recursive: true })
  }
}

/** Deep merge that handles nested objects like cleaner and schedule */
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key]
    const tgtVal = target[key]
    if (
      srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal !== null && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal as any)
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T]
    }
  }
  return result
}

function readStore(): StoreData {
  ensureDir()
  try {
    if (existsSync(getConfigPath())) {
      const raw = readFileSync(getConfigPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      return deepMerge(defaults, parsed)
    }
  } catch {
    // Corrupt file, use defaults
  }
  return { ...defaults }
}

function writeStore(data: StoreData): void {
  ensureDir()
  writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function getSettings(): DustForgeSettings {
  return readStore().settings
}

export function setSettings(partial: Partial<DustForgeSettings>): void {
  const data = readStore()
  data.settings = deepMerge(data.settings, partial)
  writeStore(data)
}

export function getOnboardingComplete(): boolean {
  return readStore().onboardingComplete
}

export function setOnboardingComplete(value: boolean): void {
  const data = readStore()
  data.onboardingComplete = value
  writeStore(data)
}

