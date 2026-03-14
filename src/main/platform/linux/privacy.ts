import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PlatformPrivacy, PrivacySettingDef } from '../types'

const execFileAsync = promisify(execFile)

export function createLinuxPrivacy(): PlatformPrivacy {
  return {
    getSettings(): PrivacySettingDef[] {
      const desktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase() ?? ''
      if (desktop.includes('gnome') || desktop.includes('unity')) {
        return LINUX_PRIVACY_SETTINGS
      }
      if (desktop.includes('kde') || desktop.includes('plasma')) {
        return KDE_PRIVACY_SETTINGS
      }
      return []
    },
  }
}

async function gsettingsGet(schema: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/gsettings', ['get', schema, key], { timeout: 5_000 })
  return stdout.trim()
}

async function gsettingsSet(schema: string, key: string, value: string): Promise<void> {
  await execFileAsync('/usr/bin/gsettings', ['set', schema, key, value], { timeout: 5_000 })
}

const LINUX_PRIVACY_SETTINGS: PrivacySettingDef[] = [
  {
    id: 'gnome-usage-stats',
    category: 'telemetry',
    label: 'Usage Statistics',
    description: 'Disable GNOME usage statistics collection',
    requiresAdmin: false,
    async check() {
      try {
        const val = await gsettingsGet('org.gnome.desktop.privacy', 'send-software-usage-stats')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await gsettingsSet('org.gnome.desktop.privacy', 'send-software-usage-stats', 'false')
    },
  },
  {
    id: 'gnome-recent-files',
    category: 'services',
    label: 'Recent Files Tracking',
    description: 'Disable tracking of recently used files',
    requiresAdmin: false,
    async check() {
      try {
        const val = await gsettingsGet('org.gnome.desktop.privacy', 'remember-recent-files')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await gsettingsSet('org.gnome.desktop.privacy', 'remember-recent-files', 'false')
    },
  },
  {
    id: 'gnome-location',
    category: 'telemetry',
    label: 'Location Services',
    description: 'Disable GNOME location services',
    requiresAdmin: false,
    async check() {
      try {
        const val = await gsettingsGet('org.gnome.system.location', 'enabled')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await gsettingsSet('org.gnome.system.location', 'enabled', 'false')
    },
  },
  {
    id: 'gnome-crash-reporting',
    category: 'telemetry',
    label: 'Crash Reporting (Apport)',
    description: 'Disable automatic crash report submission',
    requiresAdmin: false,
    async check() {
      try {
        const val = await gsettingsGet('com.ubuntu.update-notifier', 'show-apport-crashes')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await gsettingsSet('com.ubuntu.update-notifier', 'show-apport-crashes', 'false')
    },
  },
  {
    id: 'gnome-connectivity-check',
    category: 'telemetry',
    label: 'Connectivity Check',
    description: 'Disable periodic network connectivity checks',
    requiresAdmin: true,
    async check() {
      try {
        // Read the ConnectivityCheckEnabled D-Bus property directly
        const { stdout } = await execFileAsync('/usr/bin/busctl', [
          'get-property', 'org.freedesktop.NetworkManager',
          '/org/freedesktop/NetworkManager',
          'org.freedesktop.NetworkManager',
          'ConnectivityCheckEnabled',
        ], { timeout: 5_000 })
        // busctl returns: "b false" or "b true"
        return stdout.trim().endsWith('false')
      } catch { return false }
    },
    async apply() {
      // Requires writing to NM config — needs root
      await execFileAsync('/usr/bin/busctl', [
        'set-property', 'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'ConnectivityCheckEnabled', 'b', 'false',
      ], { timeout: 5_000 })
    },
  },
]

// ─── KDE Plasma helpers ──────────────────────────────────

async function kdeConfigRead(file: string, group: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/kreadconfig5', [
    '--file', file, '--group', group, '--key', key,
  ], { timeout: 5_000 })
  return stdout.trim()
}

async function kdeConfigWrite(file: string, group: string, key: string, value: string): Promise<void> {
  await execFileAsync('/usr/bin/kwriteconfig5', [
    '--file', file, '--group', group, '--key', key, value,
  ], { timeout: 5_000 })
}

const KDE_PRIVACY_SETTINGS: PrivacySettingDef[] = [
  {
    id: 'kde-usage-stats',
    category: 'telemetry',
    label: 'Usage Statistics',
    description: 'Disable KDE Plasma user feedback',
    requiresAdmin: false,
    async check() {
      try {
        const val = await kdeConfigRead('PlasmaUserFeedback', 'Global', 'FeedbackLevel')
        return val === '0'
      } catch { return false }
    },
    async apply() {
      await kdeConfigWrite('PlasmaUserFeedback', 'Global', 'FeedbackLevel', '0')
    },
  },
  {
    id: 'kde-recent-files',
    category: 'services',
    label: 'Recent Files Tracking',
    description: 'Disable KDE activity history for recent files',
    requiresAdmin: false,
    async check() {
      try {
        const val = await kdeConfigRead('kactivitymanagerdrc', 'Plugins', 'org.kde.ActivityManager.ResourceScoringEnabled')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await kdeConfigWrite('kactivitymanagerdrc', 'Plugins', 'org.kde.ActivityManager.ResourceScoringEnabled', 'false')
    },
  },
  {
    id: 'kde-baloo',
    category: 'services',
    label: 'File Indexing (Baloo)',
    description: 'Disable Baloo file indexer',
    requiresAdmin: false,
    async check() {
      try {
        const val = await kdeConfigRead('baloofilerc', 'Basic Settings', 'Indexing-Enabled')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await kdeConfigWrite('baloofilerc', 'Basic Settings', 'Indexing-Enabled', 'false')
    },
  },
  {
    id: 'kde-crash-reporting',
    category: 'telemetry',
    label: 'Crash Reporting (DrKonqi)',
    description: 'Disable KDE crash report handler',
    requiresAdmin: false,
    async check() {
      try {
        const val = await kdeConfigRead('drkonqirc', 'General', 'Enabled')
        return val === 'false'
      } catch { return false }
    },
    async apply() {
      await kdeConfigWrite('drkonqirc', 'General', 'Enabled', 'false')
    },
  },
]
