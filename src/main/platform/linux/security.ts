import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, stat } from 'fs/promises'
import type { PlatformSecurity } from '../types'
import type { HealthReport } from '../../services/cloud-agent-types'

const execFileAsync = promisify(execFile)

export function createLinuxSecurity(): PlatformSecurity {
  return {
    async collectAntivirusStatus(): Promise<HealthReport['securityPosture']['antivirus']> {
      const products: HealthReport['securityPosture']['antivirus']['products'] = []
      let primary: string | null = null

      // Check for ClamAV by probing known install paths directly
      const clamscanPaths = ['/usr/bin/clamscan', '/usr/local/bin/clamscan', '/bin/clamscan']
      for (const clamscanPath of clamscanPaths) {
        try {
          const { stdout: version } = await execFileAsync(clamscanPath, ['--version'], { timeout: 5_000 })
          products.push({
            name: `ClamAV (${version.trim().split('\n')[0]})`,
            enabled: true,
            realTimeProtection: false,
            signatureUpToDate: true,
          })
          primary = 'ClamAV'
          break
        } catch { /* not at this path */ }
      }

      // SELinux detection
      try {
        const { stdout } = await execFileAsync('/usr/sbin/getenforce', [], { timeout: 5_000 })
        const mode = stdout.trim() // "Enforcing", "Permissive", or "Disabled"
        products.push({
          name: `SELinux (${mode})`,
          enabled: mode === 'Enforcing',
          realTimeProtection: mode === 'Enforcing',
          signatureUpToDate: true,
        })
      } catch { /* not installed */ }

      // AppArmor detection
      try {
        const { stdout } = await execFileAsync('/usr/sbin/aa-status', ['--json'], { timeout: 5_000 })
        const data = JSON.parse(stdout)
        const profiles = data.profiles ?? {}
        const enforced = Object.values(profiles).filter((v: unknown) => v === 'enforce').length
        products.push({
          name: `AppArmor (${enforced} profiles enforcing)`,
          enabled: enforced > 0,
          realTimeProtection: enforced > 0,
          signatureUpToDate: true,
        })
      } catch { /* not installed */ }

      return { products, primary }
    },

    async collectFirewallStatus(): Promise<HealthReport['securityPosture']['firewall']> {
      const noProfiles = { domain: false, private: false, public: false }

      // UFW (Ubuntu/Debian front-end)
      try {
        const { stdout } = await execFileAsync('/usr/sbin/ufw', ['status'], { timeout: 10_000 })
        const enabled = stdout.includes('Status: active')
        return { enabled, products: [{ name: 'UFW', enabled }], windowsProfiles: noProfiles }
      } catch { /* not available */ }

      // firewalld (Fedora/RHEL/CentOS)
      try {
        const { stdout } = await execFileAsync('/usr/bin/firewall-cmd', ['--state'], { timeout: 10_000 })
        const enabled = stdout.trim() === 'running'
        return { enabled, products: [{ name: 'firewalld', enabled }], windowsProfiles: noProfiles }
      } catch { /* not available */ }

      // nftables (modern default on Debian 11+, Ubuntu 22.04+, Fedora, RHEL 9+)
      try {
        const { stdout } = await execFileAsync('/usr/sbin/nft', ['list', 'ruleset'], { timeout: 10_000 })
        // If there are any tables defined, nftables is active
        const enabled = stdout.includes('table ')
        return { enabled, products: [{ name: 'nftables', enabled }], windowsProfiles: noProfiles }
      } catch { /* not available */ }

      // iptables (legacy fallback)
      try {
        const { stdout } = await execFileAsync('/usr/sbin/iptables', ['-L', '-n'], { timeout: 10_000 })
        // If there are rules beyond default ACCEPT policies, consider it enabled
        const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('Chain') && !l.startsWith('target'))
        const enabled = lines.length > 0
        return { enabled, products: [{ name: 'iptables', enabled }], windowsProfiles: noProfiles }
      } catch {
        return { enabled: false, products: [], windowsProfiles: noProfiles }
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
      type UpdateResult = HealthReport['securityPosture']['windowsUpdate']
      let result: UpdateResult = { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null }

      // Try to detect the last package update time
      try {
        // APT-based systems
        const aptLog = '/var/log/apt/history.log'
        const aptStat = await stat(aptLog).catch(() => null)
        if (aptStat) {
          const lastPatchDate = aptStat.mtime.toISOString().split('T')[0]
          const daysSinceLastPatch = Math.floor((Date.now() - aptStat.mtime.getTime()) / (1000 * 60 * 60 * 24))
          result = {
            recentPatches: [{ id: 'apt', installedOn: lastPatchDate, description: 'Last APT update' }],
            lastPatchDate,
            daysSinceLastPatch,
          }
        }
      } catch { /* try dnf */ }

      if (result.recentPatches.length === 0) {
        try {
          const { stdout } = await execFileAsync('/usr/bin/dnf', ['history', '--json'], { timeout: 15_000 })
          const history = JSON.parse(stdout)
          if (Array.isArray(history) && history.length > 0) {
            const latest = history[0]
            const date = latest.date ?? ''
            result = {
              recentPatches: [{ id: String(latest.id ?? ''), installedOn: date, description: latest.command ?? '' }],
              lastPatchDate: date,
              daysSinceLastPatch: date ? Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)) : null,
            }
          }
        } catch { /* try pacman */ }
      }

      if (result.recentPatches.length === 0) {
        try {
          const { stdout } = await execFileAsync('/usr/bin/tail', ['-1', '/var/log/pacman.log'], { timeout: 5_000 })
          const match = stdout.match(/\[(\d{4}-\d{2}-\d{2})/)
          if (match) {
            const lastPatchDate = match[1]
            const daysSinceLastPatch = Math.floor((Date.now() - new Date(lastPatchDate).getTime()) / (1000 * 60 * 60 * 24))
            result = {
              recentPatches: [{ id: 'pacman', installedOn: lastPatchDate, description: 'Last pacman transaction' }],
              lastPatchDate,
              daysSinceLastPatch,
            }
          }
        } catch { /* ignore */ }
      }

      // Check for automatic update configuration
      try {
        const content = await readFile('/etc/apt/apt.conf.d/20auto-upgrades', 'utf-8')
        const autoEnabled = content.includes('APT::Periodic::Unattended-Upgrade "1"')
        result.recentPatches.push({
          id: 'auto-updates',
          installedOn: '',
          description: autoEnabled ? 'Unattended upgrades: enabled' : 'Unattended upgrades: disabled',
        })
      } catch {
        // Try dnf-automatic
        try {
          const { stdout } = await execFileAsync('/usr/bin/systemctl', ['is-enabled', 'dnf-automatic.timer'], { timeout: 5_000 })
          const autoEnabled = stdout.trim() === 'enabled'
          result.recentPatches.push({
            id: 'auto-updates',
            installedOn: '',
            description: autoEnabled ? 'dnf-automatic: enabled' : 'dnf-automatic: disabled',
          })
        } catch { /* not available */ }
      }

      return result
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
      let complexityRequired = false
      let lockoutThreshold = 0
      let lockoutDurationMin = 0

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

      // Parse /etc/security/pwquality.conf for complexity rules
      try {
        const content = await readFile('/etc/security/pwquality.conf', 'utf-8')
        const getQVal = (key: string): number => {
          const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(-?\\d+)`, 'm'))
          return match ? parseInt(match[1], 10) : 0
        }
        const pwqMinLen = getQVal('minlen')
        if (pwqMinLen > minLength) minLength = pwqMinLen
        // Negative credit values mean that many characters of that class are required
        const dcredit = getQVal('dcredit')
        const ucredit = getQVal('ucredit')
        const lcredit = getQVal('lcredit')
        const ocredit = getQVal('ocredit')
        complexityRequired = dcredit < 0 || ucredit < 0 || lcredit < 0 || ocredit < 0
      } catch { /* pwquality not configured */ }

      // Parse /etc/security/faillock.conf for account lockout
      try {
        const content = await readFile('/etc/security/faillock.conf', 'utf-8')
        const getFlVal = (key: string): number => {
          const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, 'm'))
          return match ? parseInt(match[1], 10) : 0
        }
        lockoutThreshold = getFlVal('deny')
        lockoutDurationMin = Math.ceil(getFlVal('unlock_time') / 60)
      } catch { /* not configured */ }

      return {
        minLength,
        maxAgeDays,
        minAgeDays,
        historyCount: 0,
        complexityRequired,
        lockoutThreshold,
        lockoutDurationMin,
        lockoutObservationMin: 0,
        windowsHello: { enrolled: false, faceEnabled: false, fingerprintEnabled: false, pinEnabled: false },
      }
    },
  }
}
