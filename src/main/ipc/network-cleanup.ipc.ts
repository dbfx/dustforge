import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/channels'
import type { NetworkItem, NetworkCleanResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

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
        if (/["\x00-\x1f]/.test(name)) continue
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

// ── Exported core logic (used by both IPC handlers and CLI) ──

export async function scanNetwork(): Promise<NetworkItem[]> {
  const items: NetworkItem[] = []

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

  return items
}

export async function cleanNetworkItems(items: NetworkItem[]): Promise<NetworkCleanResult> {
  let cleaned = 0
  let failed = 0
  const details: string[] = []

  for (const item of items) {
    try {
      switch (item.type) {
        case 'dns-cache':
          await execFileAsync('ipconfig', ['/flushdns'], { timeout: 10000 })
          details.push('Flushed DNS resolver cache')
          cleaned++
          break

        case 'wifi-profile':
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
}

// ── IPC registration ──

const scanSessions = new Map<string, Map<string, NetworkItem>>()
let activeScanId = ''

export function registerNetworkCleanupIpc(): void {
  ipcMain.handle(IPC.NETWORK_SCAN, async (): Promise<NetworkItem[]> => {
    const items = await scanNetwork()

    const scanId = randomUUID()
    const sessionMap = new Map<string, NetworkItem>()
    for (const item of items) sessionMap.set(item.id, item)
    scanSessions.set(scanId, sessionMap)
    activeScanId = scanId
    const sessionKeys = [...scanSessions.keys()]
    while (sessionKeys.length > 3) scanSessions.delete(sessionKeys.shift()!)

    return items
  })

  ipcMain.handle(IPC.NETWORK_CLEAN, async (_event, itemIds: string[]): Promise<NetworkCleanResult> => {
    const session = scanSessions.get(activeScanId)
    const items: NetworkItem[] = []
    for (const id of itemIds) {
      const item = session?.get(id)
      if (item) items.push(item)
    }
    return cleanNetworkItems(items)
  })
}
