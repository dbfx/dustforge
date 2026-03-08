import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/channels'
import type { NetworkItem, NetworkCleanResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

// Session-scoped scan results keyed by scan ID to prevent race conditions
const scanSessions = new Map<string, Map<string, NetworkItem>>()
let activeScanId = ''

async function getDnsCacheCount(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      '(Get-DnsClientCache | Measure-Object).Count'
    ], { timeout: 10000 })
    return parseInt(stdout.trim(), 10) || 0
  } catch {
    return 0
  }
}

async function getWifiProfiles(): Promise<{ name: string; auth: string }[]> {
  try {
    const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'profiles'], { timeout: 10000 })
    const profiles: { name: string; auth: string }[] = []
    const lines = stdout.split('\n')
    for (const line of lines) {
      const match = line.match(/All User Profile\s*:\s*(.+)/i) || line.match(/User Profile\s*:\s*(.+)/i)
      if (match) {
        const name = match[1].trim()
        // Get auth type for detail
        let auth = 'Unknown'
        try {
          const { stdout: detail } = await execFileAsync('netsh', ['wlan', 'show', 'profile', `name="${name}"`], { timeout: 5000 })
          const authMatch = detail.match(/Authentication\s*:\s*(.+)/i)
          if (authMatch) auth = authMatch[1].trim()
        } catch { /* skip */ }
        profiles.push({ name, auth })
      }
    }
    return profiles
  } catch {
    return []
  }
}

async function getArpEntryCount(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 10000 })
    const lines = stdout.split('\n').filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l))
    return lines.length
  } catch {
    return 0
  }
}

async function getNetworkHistory(): Promise<{ name: string; guid: string }[]> {
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles',
      '/s'
    ], { timeout: 10000 })
    const entries: { name: string; guid: string }[] = []
    let currentGuid = ''
    for (const line of stdout.split('\n')) {
      const guidMatch = line.match(/\\(\{[0-9A-F-]+\})$/i)
      if (guidMatch) {
        currentGuid = guidMatch[1]
      }
      const nameMatch = line.match(/ProfileName\s+REG_SZ\s+(.+)/i)
      if (nameMatch && currentGuid) {
        entries.push({ name: nameMatch[1].trim(), guid: currentGuid })
      }
    }
    return entries
  } catch {
    return []
  }
}

export function registerNetworkCleanupIpc(): void {
  ipcMain.handle(IPC.NETWORK_SCAN, async (): Promise<NetworkItem[]> => {
    const items: NetworkItem[] = []
    const scanId = randomUUID()
    const sessionMap = new Map<string, NetworkItem>()

    // DNS cache
    const dnsCount = await getDnsCacheCount()
    if (dnsCount > 0) {
      items.push({
        id: randomUUID(),
        type: 'dns-cache',
        label: 'DNS Resolver Cache',
        detail: `${dnsCount} cached entries — flushing forces fresh DNS lookups`,
        selected: true
      })
    }

    // Wi-Fi profiles
    const wifiProfiles = await getWifiProfiles()
    for (const profile of wifiProfiles) {
      items.push({
        id: randomUUID(),
        type: 'wifi-profile',
        label: profile.name,
        detail: `Wi-Fi profile · ${profile.auth}`,
        selected: false
      })
    }

    // ARP cache
    const arpCount = await getArpEntryCount()
    if (arpCount > 0) {
      items.push({
        id: randomUUID(),
        type: 'arp-cache',
        label: 'ARP Cache',
        detail: `${arpCount} entries — maps IP addresses to hardware addresses`,
        selected: true
      })
    }

    // Network history (past connections stored in registry)
    const history = await getNetworkHistory()
    for (const entry of history) {
      items.push({
        id: randomUUID(),
        type: 'network-history',
        label: entry.name,
        detail: `Saved network profile · ${entry.guid}`,
        selected: false
      })
    }

    for (const item of items) {
      sessionMap.set(item.id, item)
    }

    // Store session and update active scan ID
    scanSessions.set(scanId, sessionMap)
    activeScanId = scanId

    // Clean up old sessions (keep only last 3)
    const sessionKeys = [...scanSessions.keys()]
    while (sessionKeys.length > 3) {
      scanSessions.delete(sessionKeys.shift()!)
    }

    return items
  })

  ipcMain.handle(IPC.NETWORK_CLEAN, async (_event, itemIds: string[]): Promise<NetworkCleanResult> => {
    let cleaned = 0
    let failed = 0
    const details: string[] = []

    // Look up items from the active scan session
    const session = scanSessions.get(activeScanId)

    for (const id of itemIds) {
      const item = session?.get(id)
      if (!item) continue

      try {
        switch (item.type) {
          case 'dns-cache':
            await execFileAsync('ipconfig', ['/flushdns'], { timeout: 10000 })
            details.push('Flushed DNS resolver cache')
            cleaned++
            break

          case 'wifi-profile':
            // Validate Wi-Fi profile name contains no control chars or quotes
            if (!item.label || /["\x00-\x1f]/.test(item.label)) {
              failed++
              details.push(`Invalid profile name: ${item.label}`)
              continue
            }
            await execFileAsync('netsh', ['wlan', 'delete', 'profile', `name="${item.label}"`], { timeout: 10000 })
            details.push(`Removed Wi-Fi profile: ${item.label}`)
            cleaned++
            break

          case 'arp-cache':
            await execFileAsync('netsh', ['interface', 'ip', 'delete', 'arpcache'], { timeout: 10000 })
            details.push('Cleared ARP cache')
            cleaned++
            break

          case 'network-history': {
            // Strict GUID validation: {8-4-4-4-12} hex format only
            const guidMatch = item.detail.match(/(\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\})/)
            if (guidMatch) {
              await execFileAsync('reg', [
                'delete',
                `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles\\${guidMatch[1]}`,
                '/f'
              ], { timeout: 10000 })
              details.push(`Removed network history: ${item.label}`)
              cleaned++
            }
            break
          }
        }
      } catch {
        failed++
        details.push(`Failed to clean: ${item.label}`)
      }
    }

    return { cleaned, failed, details }
  })
}
