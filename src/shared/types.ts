export interface ScanHistoryCategory {
  name: string
  itemsFound: number
  itemsCleaned: number
  spaceSaved: number
}

export interface ScanHistoryEntry {
  id: string
  type: 'cleaner' | 'registry' | 'debloater' | 'network'
  timestamp: string
  duration: number
  totalItemsFound: number
  totalItemsCleaned: number
  totalItemsSkipped: number
  totalSpaceSaved: number
  categories: ScanHistoryCategory[]
  errorCount: number
}

export interface ScanItem {
  id: string
  path: string
  size: number
  category: string
  subcategory: string
  lastModified: number
  selected: boolean
}

export interface ScanResult {
  category: string
  subcategory: string
  group?: string
  items: ScanItem[]
  totalSize: number
  itemCount: number
}

export interface CleanResult {
  totalCleaned: number
  filesDeleted: number
  filesSkipped: number
  errors: CleanError[]
}

export interface CleanError {
  path: string
  reason: string
}

export interface ProgressData {
  phase: 'scanning' | 'cleaning'
  category: string
  currentPath: string
  progress: number
  itemsFound: number
  sizeFound: number
}

export interface RegistryFixAction {
  op: 'delete-value' | 'delete-key' | 'set-value' | 'disable-task' | 'delete-task'
  key?: string        // full registry key (overrides keyPath if abbreviated)
  value?: string      // value name (overrides valueName if different)
  regType?: string    // REG_DWORD, REG_SZ
  data?: string       // value data to set
}

export interface RegistryEntry {
  id: string
  type: 'obsolete' | 'invalid' | 'orphaned' | 'broken' | 'vulnerability' | 'privacy' | 'performance' | 'network' | 'service' | 'task'
  keyPath: string
  valueName: string
  issue: string
  risk: 'low' | 'medium' | 'high'
  selected: boolean
  fix?: RegistryFixAction
}

export interface StartupItem {
  id: string
  name: string
  displayName: string
  command: string
  location: string
  source: 'registry-hkcu' | 'registry-hklm' | 'startup-folder' | 'task-scheduler'
  enabled: boolean
  publisher: string
  impact: 'high' | 'medium' | 'low' | 'none'
}

export interface StartupBootEntry {
  name: string
  displayName: string
  delayMs: number
  source: StartupItem['source']
  impact: StartupItem['impact']
}

export interface StartupBootTrace {
  totalBootMs: number
  lastBootDate: string | null
  mainPathMs: number
  startupAppsMs: number
  entries: StartupBootEntry[]
  available: boolean
  needsAdmin: boolean
}

export interface DiskNode {
  name: string
  path: string
  size: number
  children?: DiskNode[]
  isFile?: boolean
}

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
  usedSpace: number
}

export interface AppStats {
  totalSpaceSaved: number
  totalFilesCleaned: number
  totalScans: number
  lastScanDate: string | null
  recentActivity: ActivityEntry[]
}

export interface ActivityEntry {
  id: string
  type: 'clean' | 'registry' | 'startup' | 'scan'
  message: string
  timestamp: string
  spaceSaved?: number
}

export interface BloatwareApp {
  id: string
  name: string
  packageName: string
  publisher: string
  category: 'microsoft' | 'oem' | 'gaming' | 'media' | 'communication' | 'utility'
  description: string
  size: string
  selected: boolean
}

export interface NetworkItem {
  id: string
  type: 'dns-cache' | 'wifi-profile' | 'arp-cache' | 'network-history'
  label: string
  detail: string
  selected: boolean
}

export interface NetworkCleanResult {
  cleaned: number
  failed: number
  details: string[]
}

export interface DustForgeSettings {
  minimizeToTray: boolean
  showNotificationOnComplete: boolean
  runAtStartup: boolean
  autoUpdate: boolean
  cleaner: {
    skipRecentMinutes: number
    secureDelete: boolean
    closeBrowsersBeforeClean: boolean
    createRestorePoint: boolean
  }
  exclusions: string[]
  schedule: {
    enabled: boolean
    frequency: 'daily' | 'weekly' | 'monthly'
    day: number
    hour: number
  }
}
