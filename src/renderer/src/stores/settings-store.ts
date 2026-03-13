import { create } from 'zustand'
import type { DustForgeSettings } from '@shared/types'

interface SettingsState {
  settings: DustForgeSettings
  loaded: boolean
  setSettings: (settings: DustForgeSettings) => void
  updateSettings: (partial: Partial<DustForgeSettings>) => void
}

const defaultSettings: DustForgeSettings = {
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
  },
  cloud: {
    apiKey: '',
    serverUrl: '',
    telemetryIntervalSec: 60,
    shareDiskHealth: true,
    shareProcessList: true,
    shareThreatMonitor: true,
    allowRemotePower: true,
    allowRemoteCleanup: true,
    allowRemoteInstalls: true,
    allowRemoteConfig: true
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  updateSettings: (partial) =>
    set((s) => ({
      settings: {
        ...s.settings,
        ...partial,
        cleaner: { ...s.settings.cleaner, ...(partial.cleaner ?? {}) },
        schedule: { ...s.settings.schedule, ...(partial.schedule ?? {}) },
        cloud: { ...s.settings.cloud, ...(partial.cloud ?? {}) }
      }
    }))
}))
