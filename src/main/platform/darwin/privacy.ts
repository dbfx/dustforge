import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PlatformPrivacy, PrivacySettingDef } from '../types'

const execFileAsync = promisify(execFile)

export function createDarwinPrivacy(): PlatformPrivacy {
  return {
    getSettings(): PrivacySettingDef[] {
      return DARWIN_PRIVACY_SETTINGS
    },
  }
}

async function defaultsRead(domain: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/defaults', ['read', domain, key], { timeout: 5_000 })
  return stdout.trim()
}

async function defaultsWrite(domain: string, key: string, type: string, value: string): Promise<void> {
  await execFileAsync('/usr/bin/defaults', ['write', domain, key, `-${type}`, value], { timeout: 5_000 })
}

const DARWIN_PRIVACY_SETTINGS: PrivacySettingDef[] = [
  {
    id: 'macos-diagnostics',
    category: 'telemetry',
    label: 'Diagnostic & Usage Data',
    description: 'Disable sharing diagnostic and usage data with Apple',
    requiresAdmin: true,
    async check() {
      try {
        const val = await defaultsRead('/Library/Application Support/CrashReporter/DiagnosticMessagesHistory', 'AutoSubmit')
        return val === '0'
      } catch { return false }
    },
    async apply() {
      await defaultsWrite('/Library/Application Support/CrashReporter/DiagnosticMessagesHistory', 'AutoSubmit', 'bool', 'false')
    },
  },
  {
    id: 'macos-siri-analytics',
    category: 'telemetry',
    label: 'Siri Analytics',
    description: 'Disable Siri analytics and improvement data collection',
    requiresAdmin: false,
    async check() {
      try {
        const val = await defaultsRead('com.apple.assistant.support', 'Siri Data Sharing Opt-In Status')
        return val === '2' // 2 = opted out
      } catch { return false }
    },
    async apply() {
      await defaultsWrite('com.apple.assistant.support', 'Siri Data Sharing Opt-In Status', 'int', '2')
    },
  },
  {
    id: 'macos-ad-tracking',
    category: 'telemetry',
    label: 'Personalized Ads',
    description: 'Limit ad tracking by Apple',
    requiresAdmin: false,
    async check() {
      try {
        const val = await defaultsRead('com.apple.AdLib', 'allowApplePersonalizedAdvertising')
        return val === '0'
      } catch { return false }
    },
    async apply() {
      await defaultsWrite('com.apple.AdLib', 'allowApplePersonalizedAdvertising', 'bool', 'false')
    },
  },
  {
    id: 'macos-safari-suggestions',
    category: 'telemetry',
    label: 'Safari Suggestions',
    description: 'Disable Safari search suggestions sent to Apple',
    requiresAdmin: false,
    async check() {
      try {
        const val = await defaultsRead('com.apple.Safari', 'UniversalSearchEnabled')
        return val === '0'
      } catch { return false }
    },
    async apply() {
      await defaultsWrite('com.apple.Safari', 'UniversalSearchEnabled', 'bool', 'false')
    },
  },
  {
    id: 'macos-spotlight-suggestions',
    category: 'telemetry',
    label: 'Spotlight Suggestions',
    description: 'Disable Spotlight web suggestions',
    requiresAdmin: false,
    async check() {
      try {
        const val = await defaultsRead('com.apple.lookup.shared', 'LookupSuggestionsDisabled')
        return val === '1'
      } catch { return false }
    },
    async apply() {
      await defaultsWrite('com.apple.lookup.shared', 'LookupSuggestionsDisabled', 'bool', 'true')
    },
  },
  {
    id: 'macos-recent-files',
    category: 'services',
    label: 'Recent Files in Finder',
    description: 'Disable tracking of recently accessed files',
    requiresAdmin: false,
    async check() {
      try {
        const val = await defaultsRead('com.apple.finder', 'FXRecentFolders')
        return val === '0' || val === '()'
      } catch {
        // Key doesn't exist = we deleted it = setting is applied
        return true
      }
    },
    async apply() {
      await execFileAsync('/usr/bin/defaults', ['delete', 'com.apple.finder', 'FXRecentFolders'], { timeout: 5_000 }).catch(() => {})
    },
  },
  {
    id: 'macos-crash-reporter',
    category: 'telemetry',
    label: 'Crash Reporter',
    description: 'Set crash reporter to not send reports automatically',
    requiresAdmin: false,
    async check() {
      try {
        const val = await defaultsRead('com.apple.CrashReporter', 'DialogType')
        return val === 'none'
      } catch { return false }
    },
    async apply() {
      await defaultsWrite('com.apple.CrashReporter', 'DialogType', 'string', 'none')
    },
  },
]
