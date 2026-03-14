import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PlatformNetwork, ActiveConnection, DnsCacheEntry, WifiProfile } from '../types'

const execFileAsync = promisify(execFile)

const LOOPBACK = new Set(['127.0.0.1', '::1', '0.0.0.0', '::'])

export function createLinuxNetwork(): PlatformNetwork {
  return {
    async getEstablishedConnections(): Promise<ActiveConnection[]> {
      try {
        // ss -tunap state established outputs lines like:
        // tcp  ESTAB  0  0  10.0.0.5:45678  93.184.216.34:443  users:(("firefox",pid=1234,fd=56))
        const { stdout } = await execFileAsync('/usr/bin/ss', [
          '-tunap', 'state', 'established',
        ], { timeout: 10_000 })

        const lines = stdout.split('\n').filter((l) => l.trim())
        const results: ActiveConnection[] = []

        for (const line of lines) {
          // Skip header line
          if (line.startsWith('Netid') || line.startsWith('State')) continue

          const cols = line.trim().split(/\s+/)
          // Columns: Netid State Recv-Q Send-Q Local Peer Process
          // When using "state established" filter, State column may be omitted
          // Find the column with remote address by looking for addr:port pattern
          let remoteCol: string | undefined
          let processCol: string | undefined

          for (let i = 0; i < cols.length; i++) {
            // Remote address is typically the 5th or 4th column
            if (cols[i]?.includes(':') && !cols[i].startsWith('users:')) {
              // Keep track — we want the second addr:port (remote)
              remoteCol = cols[i]
            }
            if (cols[i]?.startsWith('users:')) {
              processCol = cols[i]
            }
          }

          if (!remoteCol) continue

          // Parse remote address — handle IPv6 bracket notation and plain IPv4
          let remoteAddress: string
          let remotePort: number

          const lastColon = remoteCol.lastIndexOf(':')
          if (lastColon === -1) continue
          remoteAddress = remoteCol.slice(0, lastColon)
          remotePort = parseInt(remoteCol.slice(lastColon + 1), 10)

          // Strip brackets from IPv6
          if (remoteAddress.startsWith('[') && remoteAddress.endsWith(']')) {
            remoteAddress = remoteAddress.slice(1, -1)
          }
          // Handle ss format where IPv4-mapped IPv6 shows as ::ffff:x.x.x.x
          if (remoteAddress.startsWith('::ffff:')) {
            remoteAddress = remoteAddress.slice(7)
          }

          if (LOOPBACK.has(remoteAddress) || remoteAddress === '*') continue
          if (isNaN(remotePort)) continue

          // Extract PID from process column: users:(("name",pid=1234,fd=5))
          let pid: number | null = null
          if (processCol) {
            const pidMatch = processCol.match(/pid=(\d+)/)
            if (pidMatch) pid = parseInt(pidMatch[1], 10)
          }

          results.push({ remoteAddress, remotePort, pid })
        }

        return results
      } catch {
        return []
      }
    },

    async getDnsCacheEntries(): Promise<DnsCacheEntry[]> {
      // Linux generally has no user-queryable DNS cache.
      // systemd-resolved does not expose a dump of cached entries.
      return []
    },

    async flushDnsCache(): Promise<boolean> {
      try {
        // Try systemd-resolved first
        await execFileAsync('/usr/bin/resolvectl', ['flush-caches'], { timeout: 5000 })
        return true
      } catch {
        try {
          // Fallback to nscd
          await execFileAsync('/usr/sbin/nscd', ['-i', 'hosts'], { timeout: 5000 })
          return true
        } catch {
          return false
        }
      }
    },

    async getWifiProfiles(): Promise<WifiProfile[]> {
      try {
        const { stdout } = await execFileAsync('/usr/bin/nmcli', [
          '-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show',
        ], { timeout: 10000 })
        const profiles: WifiProfile[] = []
        for (const line of stdout.split('\n').filter(Boolean)) {
          const parts = line.split(':')
          if (parts.length >= 2 && parts[1]?.includes('wireless')) {
            profiles.push({ name: parts[0], security: 'Wi-Fi' })
          }
        }
        return profiles
      } catch {
        return []
      }
    },

    async deleteWifiProfile(name: string): Promise<boolean> {
      try {
        await execFileAsync('/usr/bin/nmcli', ['connection', 'delete', name], { timeout: 10000 })
        return true
      } catch {
        return false
      }
    },

    async clearArpCache(): Promise<boolean> {
      try {
        await execFileAsync('/usr/sbin/ip', ['neigh', 'flush', 'all'], { timeout: 5000 })
        return true
      } catch {
        return false
      }
    },
  }
}
