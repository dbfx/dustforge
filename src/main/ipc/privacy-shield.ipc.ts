import { BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/channels'
import type {
  PrivacySetting,
  PrivacyShieldState,
  PrivacyApplyResult
} from '../../shared/types'
import type { WindowGetter } from './index'

const execFileAsync = promisify(execFile)

// Hard timeout wrapper — guarantees a check never hangs forever
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))
  ])
}

// ─── Setting definitions ─────────────────────────────────────
// Each entry describes what "enabled = true" means for privacy
// (i.e. the privacy-friendly state).

interface SettingDef {
  id: string
  category: PrivacySetting['category']
  label: string
  description: string
  requiresAdmin: boolean
  check: () => Promise<boolean>       // returns true if already privacy-friendly
  apply: () => Promise<void>          // applies the privacy-friendly state
}

// ── Helpers ────────────────────────────────────────────────

async function regQueryDword(key: string, value: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/v', value], { timeout: 5000, windowsHide: true })
    const match = stdout.match(new RegExp(`${value}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`, 'i'))
    return match ? parseInt(match[1], 16) : null
  } catch {
    return null
  }
}

async function regSetDword(key: string, value: string, data: number): Promise<void> {
  await execFileAsync('reg', ['add', key, '/v', value, '/t', 'REG_DWORD', '/d', String(data), '/f'], { timeout: 5000, windowsHide: true })
}

async function isTaskActive(taskPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('schtasks', ['/query', '/tn', taskPath, '/fo', 'CSV', '/nh'], { timeout: 8000, windowsHide: true })
    // "Disabled" in the status column means it's not active
    return !stdout.toLowerCase().includes('disabled')
  } catch {
    return false // task doesn't exist
  }
}

async function disableTask(taskPath: string): Promise<void> {
  await execFileAsync('schtasks', ['/change', '/tn', taskPath, '/disable'], { timeout: 5000, windowsHide: true })
}

async function disableService(serviceName: string): Promise<void> {
  await execFileAsync('reg', [
    'add', `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${serviceName}`,
    '/v', 'Start', '/t', 'REG_DWORD', '/d', '4', '/f'
  ], { timeout: 5000, windowsHide: true })
}

async function isServiceEnabled(serviceName: string): Promise<boolean> {
  const val = await regQueryDword(`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${serviceName}`, 'Start')
  return val !== null && val !== 4 // 4 = disabled
}

function sendProgress(win: BrowserWindow | null, data: object): void {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.PRIVACY_PROGRESS, data)
    }
  } catch {
    // Window may have been closed during scan
  }
}

// ─── All privacy settings ────────────────────────────────────

const SETTINGS: SettingDef[] = [
  // ─── TELEMETRY ───
  {
    id: 'telemetry-level',
    category: 'telemetry',
    label: 'Windows Telemetry',
    description: 'Set diagnostic data collection to minimum (Security level only)',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry')
      return val === 0
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 0)
  },
  {
    id: 'activity-history',
    category: 'telemetry',
    label: 'Activity History',
    description: 'Stop Windows from tracking and syncing your app and file usage',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableActivityFeed')
      return val === 0
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableActivityFeed', 0)
  },
  {
    id: 'publish-activity',
    category: 'telemetry',
    label: 'Publish User Activities',
    description: 'Prevent Windows from publishing your activities to Microsoft',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities')
      return val === 0
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities', 0)
  },
  {
    id: 'feedback-frequency',
    category: 'telemetry',
    label: 'Feedback Prompts',
    description: 'Disable periodic Microsoft feedback prompts and surveys',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod', 0)
  },
  {
    id: 'handwriting-telemetry',
    category: 'telemetry',
    label: 'Handwriting Data',
    description: 'Stop sending handwriting and typing data to Microsoft',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Input\\TIPC', 'Enabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Input\\TIPC', 'Enabled', 0)
  },
  {
    id: 'input-personalization',
    category: 'telemetry',
    label: 'Input Personalization',
    description: 'Disable typing and inking personalization data collection',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Personalization\\Settings', 'AcceptedPrivacyPolicy')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Personalization\\Settings', 'AcceptedPrivacyPolicy', 0)
  },
  {
    id: 'tailored-experiences',
    category: 'telemetry',
    label: 'Tailored Experiences',
    description: 'Stop Microsoft from using diagnostic data to personalize tips and ads',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled', 0)
  },
  {
    id: 'app-launch-tracking',
    category: 'telemetry',
    label: 'App Launch Tracking',
    description: 'Stop Windows from tracking which apps you open to "improve" Start menu',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'Start_TrackProgs')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'Start_TrackProgs', 0)
  },

  // ─── ADS & SUGGESTIONS ───
  {
    id: 'advertising-id',
    category: 'ads',
    label: 'Advertising ID',
    description: 'Disable the unique advertising ID that apps use to track you',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 0)
  },
  {
    id: 'suggested-content',
    category: 'ads',
    label: 'Suggested Content in Settings',
    description: 'Block Microsoft from showing app suggestions and ads in Settings',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SubscribedContent-338393Enabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SubscribedContent-338393Enabled', 0)
  },
  {
    id: 'tips-notifications',
    category: 'ads',
    label: 'Tips & Suggestions',
    description: 'Disable Windows tips, tricks, and suggestion notifications',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SubscribedContent-338389Enabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SubscribedContent-338389Enabled', 0)
  },
  {
    id: 'start-suggestions',
    category: 'ads',
    label: 'Start Menu Suggestions',
    description: 'Disable app suggestions (ads) in the Start menu',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SystemPaneSuggestionsEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SystemPaneSuggestionsEnabled', 0)
  },
  {
    id: 'lock-screen-spotlight',
    category: 'ads',
    label: 'Lock Screen Spotlight',
    description: 'Disable Microsoft Spotlight ads and suggestions on the lock screen',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'RotatingLockScreenEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'RotatingLockScreenEnabled', 0)
  },
  {
    id: 'silently-installed-apps',
    category: 'ads',
    label: 'Silently Installed Apps',
    description: 'Prevent Windows from automatically installing promoted apps',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SilentInstalledAppsEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'SilentInstalledAppsEnabled', 0)
  },
  {
    id: 'preinstalled-apps',
    category: 'ads',
    label: 'Pre-installed App Suggestions',
    description: 'Stop Windows from suggesting pre-installed apps you haven\'t used',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'PreInstalledAppsEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', 'PreInstalledAppsEnabled', 0)
  },

  // ─── SEARCH ───
  {
    id: 'bing-start-menu',
    category: 'search',
    label: 'Bing in Start Menu',
    description: 'Stop search queries from being sent to Bing via Start menu',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions')
      return val === 1
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions', 1)
  },
  {
    id: 'bing-web-search',
    category: 'search',
    label: 'Bing Web Results',
    description: 'Disable web results in Windows Search — keep searches local only',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 0)
  },
  {
    id: 'cortana',
    category: 'search',
    label: 'Cortana',
    description: 'Disable Cortana — stops background resource usage and data collection',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', 'AllowCortana')
      return val === 0
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', 'AllowCortana', 0)
  },
  {
    id: 'search-highlights',
    category: 'search',
    label: 'Search Highlights',
    description: 'Disable trending search suggestions and web content in search box',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', 'IsDynamicSearchBoxEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', 'IsDynamicSearchBoxEnabled', 0)
  },

  // ─── SYNC & CLOUD ───
  {
    id: 'clipboard-sync',
    category: 'sync',
    label: 'Clipboard Cloud Sync',
    description: 'Prevent clipboard data from being synced across devices via the cloud',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'AllowCrossDeviceClipboard')
      return val === 0
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'AllowCrossDeviceClipboard', 0)
  },
  {
    id: 'clipboard-history',
    category: 'sync',
    label: 'Clipboard History',
    description: 'Disable clipboard history that stores copied text and images',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Clipboard', 'EnableClipboardHistory')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\SOFTWARE\\Microsoft\\Clipboard', 'EnableClipboardHistory', 0)
  },
  {
    id: 'settings-sync',
    category: 'sync',
    label: 'Settings Sync',
    description: 'Stop syncing Windows settings, themes, and passwords to your Microsoft account',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SettingSync', 'DisableSettingSync')
      return val === 2
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SettingSync', 'DisableSettingSync', 2)
  },
  {
    id: 'find-my-device',
    category: 'sync',
    label: 'Find My Device',
    description: 'Disable location-based device tracking by Microsoft',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKLM\\SOFTWARE\\Microsoft\\MdmCommon\\SettingValues', 'LocationSyncEnabled')
      return val === 0
    },
    apply: () => regSetDword('HKLM\\SOFTWARE\\Microsoft\\MdmCommon\\SettingValues', 'LocationSyncEnabled', 0)
  },

  // ─── TELEMETRY SERVICES ───
  {
    id: 'service-diagtrack',
    category: 'services',
    label: 'DiagTrack Service',
    description: 'Disable Connected User Experiences and Telemetry service',
    requiresAdmin: true,
    check: async () => !(await isServiceEnabled('DiagTrack')),
    apply: () => disableService('DiagTrack')
  },
  {
    id: 'service-dmwappush',
    category: 'services',
    label: 'WAP Push Service',
    description: 'Disable WAP Push Message routing service used for telemetry',
    requiresAdmin: true,
    check: async () => !(await isServiceEnabled('dmwappushservice')),
    apply: () => disableService('dmwappushservice')
  },
  {
    id: 'service-mapsbroker',
    category: 'services',
    label: 'Maps Broker',
    description: 'Disable Downloaded Maps Manager — unnecessary background service',
    requiresAdmin: true,
    check: async () => !(await isServiceEnabled('MapsBroker')),
    apply: () => disableService('MapsBroker')
  },

  // ─── TELEMETRY TASKS ───
  {
    id: 'task-compatibility-appraiser',
    category: 'tasks',
    label: 'Compatibility Appraiser',
    description: 'Disable Microsoft telemetry collector for compatibility data',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser')),
    apply: () => disableTask('\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser')
  },
  {
    id: 'task-program-data-updater',
    category: 'tasks',
    label: 'Program Data Updater',
    description: 'Disable background program telemetry upload task',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater')),
    apply: () => disableTask('\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater')
  },
  {
    id: 'task-autochk-proxy',
    category: 'tasks',
    label: 'Autochk Proxy',
    description: 'Disable telemetry data collection via autochk proxy',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Autochk\\Proxy')),
    apply: () => disableTask('\\Microsoft\\Windows\\Autochk\\Proxy')
  },
  {
    id: 'task-ceip-consolidator',
    category: 'tasks',
    label: 'CEIP Consolidator',
    description: 'Disable Customer Experience Improvement Program data upload',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator')),
    apply: () => disableTask('\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator')
  },
  {
    id: 'task-usb-ceip',
    category: 'tasks',
    label: 'USB CEIP',
    description: 'Disable USB device usage telemetry collection',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip')),
    apply: () => disableTask('\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip')
  },
  {
    id: 'task-disk-diagnostic',
    category: 'tasks',
    label: 'Disk Diagnostic Collector',
    description: 'Disable disk diagnostic data collection and upload',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector')),
    apply: () => disableTask('\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector')
  },
  {
    id: 'task-feedback-dm',
    category: 'tasks',
    label: 'Feedback DM Client',
    description: 'Disable feedback device management telemetry task',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient')),
    apply: () => disableTask('\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient')
  },
  {
    id: 'task-maps-update',
    category: 'tasks',
    label: 'Maps Update Task',
    description: 'Disable automatic map data downloads in the background',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Maps\\MapsUpdateTask')),
    apply: () => disableTask('\\Microsoft\\Windows\\Maps\\MapsUpdateTask')
  },
  {
    id: 'task-maps-toast',
    category: 'tasks',
    label: 'Maps Toast Task',
    description: 'Disable Maps notification task',
    requiresAdmin: true,
    check: async () => !(await isTaskActive('\\Microsoft\\Windows\\Maps\\MapsToastTask')),
    apply: () => disableTask('\\Microsoft\\Windows\\Maps\\MapsToastTask')
  }
]

// ─── Exported core logic ─────────────────────────────────────

export { SETTINGS as PRIVACY_SETTINGS }

export async function scanPrivacy(
  onProgress?: (data: { current: number; total: number; currentLabel: string; category: string }) => void
): Promise<PrivacyShieldState> {
    const settings: PrivacySetting[] = []
    const total = SETTINGS.length

    for (let i = 0; i < SETTINGS.length; i++) {
      const def = SETTINGS[i]

      onProgress?.({
        current: i + 1,
        total,
        currentLabel: def.label,
        category: def.category
      })

      // Each check gets a hard 10s deadline so one hanging check can't block everything
      const enabled = await withTimeout(
        def.check().catch(() => false),
        10000,
        false
      )

      settings.push({
        id: def.id,
        category: def.category,
        label: def.label,
        description: def.description,
        enabled,
        requiresAdmin: def.requiresAdmin
      })
    }

    const protectedCount = settings.filter(s => s.enabled).length
    const score = total > 0 ? Math.round((protectedCount / total) * 100) : 0

    return { settings, score, total, protected: protectedCount }
}

export async function applyPrivacySettings(ids: string[]): Promise<PrivacyApplyResult> {
    let succeeded = 0
    let failed = 0
    const errors: PrivacyApplyResult['errors'] = []

    for (const id of ids) {
      const def = SETTINGS.find(s => s.id === id)
      if (!def) continue

      try {
        await def.apply()
        succeeded++
      } catch (err) {
        failed++
        errors.push({
          id: def.id,
          label: def.label,
          reason: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    }

    return { succeeded, failed, errors }
}

// ─── IPC handlers ────────────────────────────────────────────

export function registerPrivacyShieldIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.PRIVACY_SCAN, () => scanPrivacy((data) => {
    sendProgress(getWindow(), data)
  }))

  ipcMain.handle(IPC.PRIVACY_APPLY, async (_event, ids: string[]) => {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      return { succeeded: 0, failed: 0, errors: [] }
    }
    return applyPrivacySettings(ids)
  })
}
