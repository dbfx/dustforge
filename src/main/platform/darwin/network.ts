import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PlatformNetwork, ActiveConnection, DnsCacheEntry } from '../types'

const execFileAsync = promisify(execFile)

const LOOPBACK = new Set(['127.0.0.1', '::1', '0.0.0.0', '::'])

export function createDarwinNetwork(): PlatformNetwork {
  return {
    async getEstablishedConnections(): Promise<ActiveConnection[]> {
      try {
        // lsof -i -n -P +c0 -sTCP:ESTABLISHED -F pn
        // Output format (F flag):
        //   p<pid>       — process ID
        //   n<name>      — network name, e.g. "10.0.0.5:45678->93.184.216.34:443"
        const { stdout } = await execFileAsync('/usr/sbin/lsof', [
          '-i', '-n', '-P', '+c0', '-sTCP:ESTABLISHED', '-F', 'pn',
        ], { timeout: 15_000 })

        const lines = stdout.split('\n')
        const results: ActiveConnection[] = []
        let currentPid: number | null = null

        for (const line of lines) {
          if (!line) continue

          if (line.startsWith('p')) {
            currentPid = parseInt(line.slice(1), 10)
            if (isNaN(currentPid)) currentPid = null
          } else if (line.startsWith('n')) {
            const name = line.slice(1)
            // Format: local->remote:port or [::1]:port->[::1]:port
            const arrowIdx = name.indexOf('->')
            if (arrowIdx === -1) continue

            const remote = name.slice(arrowIdx + 2)
            if (!remote) continue

            // Parse remote address:port
            let remoteAddress: string
            let remotePort: number

            if (remote.startsWith('[')) {
              // IPv6: [addr]:port
              const closeBracket = remote.indexOf(']')
              if (closeBracket === -1) continue
              remoteAddress = remote.slice(1, closeBracket)
              remotePort = parseInt(remote.slice(closeBracket + 2), 10)
            } else {
              // IPv4: addr:port
              const lastColon = remote.lastIndexOf(':')
              if (lastColon === -1) continue
              remoteAddress = remote.slice(0, lastColon)
              remotePort = parseInt(remote.slice(lastColon + 1), 10)
            }

            if (LOOPBACK.has(remoteAddress)) continue
            if (isNaN(remotePort)) continue

            results.push({ remoteAddress, remotePort, pid: currentPid })
          }
        }

        return results
      } catch {
        return []
      }
    },

    async getDnsCacheEntries(): Promise<DnsCacheEntry[]> {
      // macOS has no user-accessible DNS cache dump API.
      return []
    },
  }
}
