export interface ScanHistoryCategory {
  name: string
  itemsFound: number
  itemsCleaned: number
  spaceSaved: number
}

export interface ScanHistoryEntry {
  id: string
  type: 'cleaner' | 'registry' | 'debloater' | 'network' | 'drivers'
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
  type: 'clean' | 'registry' | 'startup' | 'scan' | 'drivers' | 'network'
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

// ─── Driver Manager ─────────────────────────────────────────
export interface DriverPackage {
  id: string
  publishedName: string       // e.g. "oem42.inf"
  originalName: string        // e.g. "nvlddmkm.inf"
  provider: string
  className: string           // e.g. "Display adapters"
  version: string
  date: string
  signer: string
  folderPath: string          // full path in FileRepository
  size: number                // bytes
  isCurrent: boolean          // true = actively bound to hardware
  selected: boolean
}

export interface DriverScanResult {
  packages: DriverPackage[]
  totalStaleSize: number
  totalStaleCount: number
  totalCurrentCount: number
}

export interface DriverCleanResult {
  removed: number
  failed: number
  spaceRecovered: number
  errors: { publishedName: string; reason: string }[]
}

export interface DriverScanProgress {
  phase: 'enumerating' | 'analyzing' | 'measuring'
  current: number
  total: number
  currentDriver: string
}

export interface DriverUpdate {
  id: string
  updateId: string            // Windows Update Identity.UpdateID (used for install matching)
  deviceName: string
  deviceId: string
  className: string
  currentVersion: string
  currentDate: string
  availableVersion: string
  availableDate: string
  provider: string
  updateTitle: string       // Windows Update title string
  downloadSize: string      // human-readable size from WU
  selected: boolean
}

export interface DriverUpdateScanResult {
  updates: DriverUpdate[]
  totalAvailable: number
  scanDuration: number
}

export interface DriverUpdateInstallResult {
  installed: number
  failed: number
  rebootRequired: boolean
  errors: { deviceName: string; reason: string }[]
}

export interface DriverUpdateProgress {
  phase: 'checking' | 'downloading' | 'installing'
  current: number
  total: number
  currentDevice: string
  percent: number
}

export interface RestorePointResult {
  success: boolean
  error?: string
}

// ─── Performance Monitor ────────────────────────────────────
export interface PerfSystemInfo {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalMemBytes: number
  osVersion: string
  hostname: string
}

export interface PerfSnapshot {
  timestamp: number
  cpu: { overall: number; perCore: number[] }
  memory: { usedBytes: number; totalBytes: number; cachedBytes: number; percent: number }
  disk: { readBytesPerSec: number; writeBytesPerSec: number }
  network: { rxBytesPerSec: number; txBytesPerSec: number }
  uptime: number
}

export interface PerfProcess {
  pid: number
  name: string
  cpuPercent: number
  memBytes: number
  memPercent: number
  user: string
  started: string
  isStartupItem?: boolean
  startupItemName?: string
}

export interface PerfProcessList {
  timestamp: number
  processes: PerfProcess[]
  totalCount: number
}

export interface PerfKillResult {
  success: boolean
  error?: string
  requiresAdmin?: boolean
}

// ─── Auto-Updater ────────────────────────────────────────────
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
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
