import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  ScanResult,
  CleanResult,
  ProgressData,
  RegistryEntry,
  StartupItem,
  StartupBootTrace,
  DiskNode,
  DriveInfo,
  DustForgeSettings,
  BloatwareApp,
  ScanHistoryEntry,
  NetworkItem,
  NetworkCleanResult,
  MalwareScanResult,
  MalwareScanProgress,
  MalwareActionResult,
  PrivacyShieldState,
  PrivacyApplyResult,
  PrivacyScanProgress
} from '../shared/types'

const api = {
  // Window controls
  windowMinimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  // System cleaner
  systemScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SYSTEM_SCAN),
  systemClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.SYSTEM_CLEAN, itemIds),

  // Browser cleaner
  browserScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.BROWSER_SCAN),
  browserClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.BROWSER_CLEAN, itemIds),

  // App cleaner
  appScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.APP_SCAN),
  appClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.APP_CLEAN, itemIds),

  // Gaming cleaner
  gamingScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.GAMING_SCAN),
  gamingClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.GAMING_CLEAN, itemIds),

  // Uninstall leftovers
  uninstallLeftoversScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_SCAN),
  uninstallLeftoversClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_CLEAN, itemIds),

  // Recycle bin
  recycleBinScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.RECYCLE_BIN_SCAN),
  recycleBinClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.RECYCLE_BIN_CLEAN),

  // Registry
  registryScan: (): Promise<RegistryEntry[]> => ipcRenderer.invoke(IPC.REGISTRY_SCAN),
  registryFix: (entryIds: string[]): Promise<{ fixed: number; failed: number }> =>
    ipcRenderer.invoke(IPC.REGISTRY_FIX, entryIds),

  // Debloater
  debloaterScan: (): Promise<BloatwareApp[]> => ipcRenderer.invoke(IPC.DEBLOATER_SCAN),
  debloaterRemove: (packageNames: string[]): Promise<{ removed: number; failed: number }> =>
    ipcRenderer.invoke(IPC.DEBLOATER_REMOVE, packageNames),
  onDebloaterRemoveProgress: (callback: (data: { current: number; total: number; currentApp: string; status: 'removing' | 'done' | 'failed' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { current: number; total: number; currentApp: string; status: 'removing' | 'done' | 'failed' }) => callback(data)
    ipcRenderer.on(IPC.DEBLOATER_REMOVE_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.DEBLOATER_REMOVE_PROGRESS, handler)
  },

  // Startup manager
  startupList: (): Promise<StartupItem[]> => ipcRenderer.invoke(IPC.STARTUP_LIST),
  startupToggle: (name: string, location: string, command: string, source: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_TOGGLE, name, location, command, source, enabled),
  startupDelete: (name: string, location: string, source: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_DELETE, name, location, source),
  startupBootTrace: (): Promise<StartupBootTrace> => ipcRenderer.invoke(IPC.STARTUP_BOOT_TRACE),

  // Network cleanup
  networkScan: (): Promise<NetworkItem[]> => ipcRenderer.invoke(IPC.NETWORK_SCAN),
  networkClean: (itemIds: string[]): Promise<NetworkCleanResult> =>
    ipcRenderer.invoke(IPC.NETWORK_CLEAN, itemIds),

  // Disk analyzer
  diskAnalyze: (driveLetter: string): Promise<DiskNode> =>
    ipcRenderer.invoke(IPC.DISK_ANALYZE, driveLetter),
  diskDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke(IPC.DISK_DRIVES),

  // Onboarding
  onboardingGet: (): Promise<boolean> => ipcRenderer.invoke(IPC.ONBOARDING_GET),
  onboardingSet: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.ONBOARDING_SET, value),

  // Settings
  settingsGet: (): Promise<DustForgeSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (settings: Partial<DustForgeSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings),

  // Elevation
  elevationCheck: (): Promise<boolean> => ipcRenderer.invoke(IPC.ELEVATION_CHECK),

  // Scheduled scans
  scheduleNextScan: (): Promise<string | null> => ipcRenderer.invoke(IPC.SCHEDULE_NEXT_SCAN),
  applyStartup: (enabled: boolean) => ipcRenderer.send(IPC.SETTINGS_APPLY_STARTUP, enabled),
  applyTray: (enabled: boolean) => ipcRenderer.send(IPC.SETTINGS_APPLY_TRAY, enabled),
  onScheduledScanTrigger: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.SCHEDULE_SCAN_TRIGGER, handler)
    return () => ipcRenderer.removeListener(IPC.SCHEDULE_SCAN_TRIGGER, handler)
  },
  notifyScheduledScanComplete: (totalSize: number, itemCount: number) =>
    ipcRenderer.send(IPC.SCHEDULE_SCAN_COMPLETE, totalSize, itemCount),

  // Scan history
  historyGet: (): Promise<ScanHistoryEntry[]> => ipcRenderer.invoke(IPC.HISTORY_GET),
  historyAdd: (entry: ScanHistoryEntry): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_ADD, entry),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),

  // Privacy Shield
  privacyScan: (): Promise<PrivacyShieldState> => ipcRenderer.invoke(IPC.PRIVACY_SCAN),
  privacyApply: (ids: string[]): Promise<PrivacyApplyResult> =>
    ipcRenderer.invoke(IPC.PRIVACY_APPLY, ids),
  onPrivacyProgress: (callback: (data: PrivacyScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PrivacyScanProgress) => callback(data)
    ipcRenderer.on(IPC.PRIVACY_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.PRIVACY_PROGRESS, handler)
  },

  // Malware scanner
  malwareScan: (): Promise<MalwareScanResult> => ipcRenderer.invoke(IPC.MALWARE_SCAN),
  malwareQuarantine: (paths: string[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_QUARANTINE, paths),
  malwareDelete: (paths: string[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_DELETE, paths),
  malwareRestore: (quarantinedPath: string, originalPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_RESTORE, quarantinedPath, originalPath),
  onMalwareProgress: (callback: (data: MalwareScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: MalwareScanProgress) => callback(data)
    ipcRenderer.on(IPC.MALWARE_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.MALWARE_PROGRESS, handler)
  },

  // Progress events
  onScanProgress: (callback: (data: ProgressData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ProgressData) => callback(data)
    ipcRenderer.on(IPC.SCAN_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.SCAN_PROGRESS, handler)
  },
  onRegistryFixProgress: (callback: (data: { current: number; total: number; currentEntry: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { current: number; total: number; currentEntry: string }) => callback(data)
    ipcRenderer.on(IPC.REGISTRY_FIX_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.REGISTRY_FIX_PROGRESS, handler)
  }
}

export type DustForgeAPI = typeof api

contextBridge.exposeInMainWorld('dustforge', api)
