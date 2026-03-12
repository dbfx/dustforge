import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, stat } from 'fs/promises'
import type { PlatformSecurity } from '../types'
import type { HealthReport } from '../../services/cloud-agent-types'

const execFileAsync = promisify(execFile)

export function createLinuxSecurity(): PlatformSecurity {
  return {
    async collectAntivirusStatus(): Promise<HealthReport['securityPosture']['antivirus']> {
      // Check for ClamAV by probing known install paths directly
      const clamscanPaths = ['/usr/bin/clamscan', '/usr/local/bin/clamscan', '/bin/clamscan']
      for (const clamscanPath of clamscanPaths) {
        try {
          const { stdout: version } = await execFileAsync(clamscanPath, ['--version'], { timeout: 5_000 })
          return {
            products: [{
              name: `ClamAV (${version.trim().split('\n')[0]})`,
              enabled: true,
              realTimeProtection: false, // ClamAV doesn't do real-time by default
              signatureUpToDate: true,
            }],
            primary: 'ClamAV',
          }
        } catch { /* not at this path */ }
      }
      return { products: [], primary: null }
    },

    async collectFirewallStatus(): Promise<HealthReport['securityPosture']['firewall']> {
      // Try ufw first, then iptables
      try {
        const { stdout } = await execFileAsync('/usr/sbin/ufw', ['status'], { timeout: 10_000 })
        const enabled = stdout.includes('Status: active')
        return {
          enabled,
          products: [{ name: 'UFW', enabled }],
          windowsProfiles: { domain: false, private: false, public: false },
        }
      } catch { /* try iptables */ }

      try {
        const { stdout } = await execFileAsync('/usr/sbin/iptables', ['-L', '-n'], { timeout: 10_000 })
        // If there are rules beyond default ACCEPT policies, consider it enabled
        const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('Chain') && !l.startsWith('target'))
        const enabled = lines.length > 0
        return {
          enabled,
          products: [{ name: 'iptables', enabled }],
          windowsProfiles: { domain: false, private: false, public: false },
        }
      } catch {
        return {
          enabled: false,
          products: [],
          windowsProfiles: { domain: false, private: false, public: false },
        }
      }
    },

    async collectDiskEncryptionStatus(): Promise<HealthReport['securityPosture']['bitlocker']> {
      try {
        const { stdout } = await execFileAsync('/usr/bin/lsblk', [
          '-J', '-o', 'NAME,TYPE,FSTYPE,MOUNTPOINT',
        ], { timeout: 10_000 })

        const data = JSON.parse(stdout)
        const volumes: HealthReport['securityPosture']['bitlocker']['volumes'] = []

        function walk(devices: any[]): void {
          for (const dev of devices) {
            if (dev.type === 'crypt' || dev.fstype === 'crypto_LUKS') {
              volumes.push({
                mount: dev.mountpoint ?? dev.name ?? '',
                status: 'FullyEncrypted',
                protectionOn: true,
              })
            }
            if (dev.children) walk(dev.children)
          }
        }

        walk(data.blockdevices ?? [])
        return { volumes }
      } catch {
        return { volumes: [] }
      }
    },

    async collectUpdateStatus(): Promise<HealthReport['securityPosture']['windowsUpdate']> {
      // Try to detect the last package update time
      try {
        // APT-based systems
        const aptLog = '/var/log/apt/history.log'
        const aptStat = await stat(aptLog).catch(() => null)
        if (aptStat) {
          const lastPatchDate = aptStat.mtime.toISOString().split('T')[0]
          const daysSinceLastPatch = Math.floor((Date.now() - aptStat.mtime.getTime()) / (1000 * 60 * 60 * 24))
          return {
            recentPatches: [{ id: 'apt', installedOn: lastPatchDate, description: 'Last APT update' }],
            lastPatchDate,
            daysSinceLastPatch,
          }
        }
      } catch { /* try dnf */ }

      try {
        const { stdout } = await execFileAsync('/usr/bin/dnf', ['history', '--json'], { timeout: 15_000 })
        const history = JSON.parse(stdout)
        if (Array.isArray(history) && history.length > 0) {
          const latest = history[0]
          const date = latest.date ?? ''
          return {
            recentPatches: [{ id: String(latest.id ?? ''), installedOn: date, description: latest.command ?? '' }],
            lastPatchDate: date,
            daysSinceLastPatch: date ? Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)) : null,
          }
        }
      } catch { /* try pacman */ }

      try {
        const { stdout } = await execFileAsync('/usr/bin/tail', ['-1', '/var/log/pacman.log'], { timeout: 5_000 })
        const match = stdout.match(/\[(\d{4}-\d{2}-\d{2})/)
        if (match) {
          const lastPatchDate = match[1]
          const daysSinceLastPatch = Math.floor((Date.now() - new Date(lastPatchDate).getTime()) / (1000 * 60 * 60 * 24))
          return {
            recentPatches: [{ id: 'pacman', installedOn: lastPatchDate, description: 'Last pacman transaction' }],
            lastPatchDate,
            daysSinceLastPatch,
          }
        }
      } catch { /* ignore */ }

      return { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null }
    },

    async collectScreenLockStatus(): Promise<HealthReport['securityPosture']['screenLock']> {
      // GNOME settings
      try {
        const [lockResult, delayResult] = await Promise.allSettled([
          execFileAsync('/usr/bin/gsettings', ['get', 'org.gnome.desktop.screensaver', 'lock-enabled'], { timeout: 5_000 }),
          execFileAsync('/usr/bin/gsettings', ['get', 'org.gnome.desktop.session', 'idle-delay'], { timeout: 5_000 }),
        ])

        const lockEnabled = lockResult.status === 'fulfilled' && lockResult.value.stdout.trim() === 'true'
        let timeoutSec: number | null = null
        if (delayResult.status === 'fulfilled') {
          const match = delayResult.value.stdout.match(/uint32\s+(\d+)/)
          timeoutSec = match ? parseInt(match[1], 10) : null
        }

        return {
          screenSaverEnabled: timeoutSec !== null && timeoutSec > 0,
          lockOnResume: lockEnabled,
          timeoutSec,
          inactivityLockSec: null,
        }
      } catch {
        return { screenSaverEnabled: false, lockOnResume: false, timeoutSec: null, inactivityLockSec: null }
      }
    },

    async collectPasswordPolicy(): Promise<HealthReport['securityPosture']['passwordPolicy']> {
      let minLength = 0
      let maxAgeDays = 0
      let minAgeDays = 0

      // Parse /etc/login.defs
      try {
        const content = await readFile('/etc/login.defs', 'utf-8')
        const getVal = (key: string): number => {
          const match = content.match(new RegExp(`^${key}\\s+(\\d+)`, 'm'))
          return match ? parseInt(match[1], 10) : 0
        }
        minLength = getVal('PASS_MIN_LEN')
        maxAgeDays = getVal('PASS_MAX_DAYS')
        minAgeDays = getVal('PASS_MIN_DAYS')
      } catch { /* ignore */ }

      return {
        minLength,
        maxAgeDays,
        minAgeDays,
        historyCount: 0,
        complexityRequired: false,
        lockoutThreshold: 0,
        lockoutDurationMin: 0,
        lockoutObservationMin: 0,
        windowsHello: { enrolled: false, faceEnabled: false, fingerprintEnabled: false, pinEnabled: false },
      }
    },
  }
}
