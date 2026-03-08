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

export interface MalwareThreat {
  id: string
  path: string
  fileName: string
  size: number
  detectionName: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: 'defender' | 'heuristic' | 'signature'
  details: string
  selected: boolean
}

export interface MalwareScanProgress {
  phase: 'scanning' | 'quarantining' | 'deleting'
  step: 'init' | 'discovering' | 'signatures' | 'heuristics' | 'defender' | 'complete'
  stepLabel: string
  currentPath: string
  progress: number
  threatsFound: number
  filesScanned: number
  totalFiles: number
  engine: string
  completedSteps: string[]
}

export interface MalwareScanResult {
  threats: MalwareThreat[]
  filesScanned: number
  duration: number
  engines: string[]
}

export interface MalwareActionResult {
  succeeded: number
  failed: number
  errors: { path: string; reason: string }[]
}

// ─── Privacy Shield ──────────────────────────────────────────
export interface PrivacySetting {
  id: string
  category: 'telemetry' | 'ads' | 'search' | 'services' | 'tasks' | 'sync'
  label: string
  description: string
  enabled: boolean          // true = privacy-friendly (tracking disabled)
  requiresAdmin: boolean
}

export interface PrivacyShieldState {
  settings: PrivacySetting[]
  score: number             // 0-100 privacy score
  total: number             // total settings count
  protected: number         // settings already privacy-friendly
}

export interface PrivacyScanProgress {
  current: number
  total: number
  currentLabel: string
  category: string
}

export interface PrivacyApplyResult {
  succeeded: number
  failed: number
  errors: { id: string; label: string; reason: string }[]
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
