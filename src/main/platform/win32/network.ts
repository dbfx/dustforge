import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PlatformNetwork, ActiveConnection, DnsCacheEntry } from '../types'

const execFileAsync = promisify(execFile)

const LOOPBACK = new Set(['127.0.0.1', '::1', '0.0.0.0', '::'])

export function createWin32Network(): PlatformNetwork {
  return {
    async getEstablishedConnections(): Promise<ActiveConnection[]> {
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          'Get-NetTCPConnection -State Established | Select-Object RemoteAddress,RemotePort,OwningProcess | ConvertTo-Json -Compress',
        ], { timeout: 15_000, windowsHide: true })

        const trimmed = stdout.trim()
        if (!trimmed) return []

        const raw = JSON.parse(trimmed)
        const items: Array<{ RemoteAddress: string; RemotePort: number; OwningProcess: number }> =
          Array.isArray(raw) ? raw : [raw]

        return items
          .filter((c) => !LOOPBACK.has(c.RemoteAddress))
          .map((c) => ({
            remoteAddress: c.RemoteAddress,
            remotePort: c.RemotePort,
            pid: c.OwningProcess ?? null,
          }))
      } catch {
        return []
      }
    },

    async getDnsCacheEntries(): Promise<DnsCacheEntry[]> {
      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          'Get-DnsClientCache | Select-Object Entry,Data | ConvertTo-Json -Compress',
        ], { timeout: 15_000, windowsHide: true })

        const trimmed = stdout.trim()
        if (!trimmed) return []

        const raw = JSON.parse(trimmed)
        const items: Array<{ Entry: string; Data: string | null }> =
          Array.isArray(raw) ? raw : [raw]

        return items.map((e) => ({
          domain: e.Entry?.toLowerCase() ?? '',
          resolvedAddress: e.Data || null,
        }))
      } catch {
        return []
      }
    },
  }
}
