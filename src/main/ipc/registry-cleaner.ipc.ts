import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { homedir } from 'os'
import { IPC } from '../../shared/channels'
import type { RegistryEntry } from '../../shared/types'
import { randomUUID } from 'crypto'
import type { WindowGetter } from './index'

const execFileAsync = promisify(execFile)

/** Parse a CSV line handling escaped quotes ("") inside quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      i++ // skip opening quote
      let field = ''
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"'
            i += 2
          } else {
            i++ // skip closing quote
            break
          }
        } else {
          field += line[i]
          i++
        }
      }
      fields.push(field)
      if (i < line.length && line[i] === ',') i++ // skip comma
    } else if (line[i] === ',') {
      fields.push('')
      i++
    } else {
      const next = line.indexOf(',', i)
      if (next === -1) {
        fields.push(line.substring(i))
        break
      }
      fields.push(line.substring(i, next))
      i = next + 1
    }
  }
  return fields
}

/** Validate that a task path contains only safe characters */
const SAFE_TASK_PATH_RE = /^[\\A-Za-z0-9\s\-._()]+$/

/** Split a full task path like "\\Folder\\Sub\\TaskName" into { path, name } for PowerShell */
function splitTaskPath(fullPath: string): { path: string; name: string } | null {
  const normalized = fullPath.replace(/\//g, '\\')
  if (!SAFE_TASK_PATH_RE.test(normalized)) return null
  const lastSlash = normalized.lastIndexOf('\\')
  if (lastSlash >= 0) {
    return {
      path: normalized.substring(0, lastSlash + 1),
      name: normalized.substring(lastSlash + 1)
    }
  }
  return { path: '\\', name: normalized }
}

// Session-scoped scan results keyed by scan ID to prevent race conditions
const scanSessions = new Map<string, Map<string, RegistryEntry>>()
let activeScanId = ''

export function registerRegistryCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.REGISTRY_SCAN, async (): Promise<RegistryEntry[]> => {
    const entries: RegistryEntry[] = []

    // Scan for broken App Paths
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
        '/s'
      ], { timeout: 15000 })

      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const keyMatch = block.match(/^(HKLM\\[^\r\n]+)/m)
        const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
        if (valMatch) {
          const exePath = valMatch[1].trim().replace(/"/g, '')
          if (exePath && !existsSync(exePath)) {
            entries.push({
              id: randomUUID(),
              type: 'invalid',
              keyPath: keyMatch?.[1] || 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
              valueName: '(Default)',
              issue: `App path points to missing file: ${exePath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' }
            })
          }
        }
      }
    } catch {
      // Skip if reg query fails
    }

    // Scan for broken Uninstall entries
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        '/s'
      ], { timeout: 15000 })

      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const installMatch = block.match(/InstallLocation\s+REG_SZ\s+(.+)/i)
        if (installMatch) {
          const installPath = installMatch[1].trim()
          if (installPath && installPath.length > 3 && !existsSync(installPath)) {
            const keyMatch = block.match(/^(HKLM\\.+?)[\r\n]/m)
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch?.[1]?.trim() || 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\(unknown)',
              valueName: 'InstallLocation',
              issue: `Install location missing: ${installPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for broken SharedDLLs references
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs',
        '/s'
      ], { timeout: 15000 })

      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_DWORD\s+/i)
        if (match) {
          const dllPath = match[1].trim()
          if (dllPath && dllPath.length > 3 && !existsSync(dllPath)) {
            entries.push({
              id: randomUUID(),
              type: 'broken',
              keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs',
              valueName: dllPath,
              issue: `Shared DLL reference missing: ${dllPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for stale Run/RunOnce startup entries
    const runKeys = [
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
    ]
    for (const runKey of runKeys) {
      try {
        const { stdout } = await execFileAsync('reg', ['query', runKey], { timeout: 10000 })
        const lines = stdout.split(/\r?\n/)
        for (const line of lines) {
          const match = line.match(/^\s+(\S+)\s+REG_SZ\s+(.+)/i)
          if (match) {
            const valueName = match[1].trim()
            const command = match[2].trim()
            const exeMatch = command.match(/^"?([^"]+\.\w{2,4})"?/)
            if (exeMatch) {
              const exePath = exeMatch[1].trim()
              if (exePath && !existsSync(exePath)) {
                entries.push({
                  id: randomUUID(),
                  type: 'broken',
                  keyPath: runKey,
                  valueName,
                  issue: `Startup entry points to missing file: ${exePath}`,
                  risk: 'medium',
                  selected: true,
                  fix: { op: 'delete-value' }
                })
              }
            }
          }
        }
      } catch {
        // Skip
      }
    }

    // Scan for broken file associations
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts',
        '/s'
      ], { timeout: 15000 })

      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const keyMatch = block.match(/^(HKCU\\[^\r\n]+\\OpenWithList)/m)
        const appMatch = block.match(/REG_SZ\s+(.+\.exe)/i)
        if (keyMatch && appMatch) {
          const appName = appMatch[1].trim()
          try {
            await execFileAsync('reg', [
              'query',
              `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${appName}`
            ], { timeout: 5000 })
          } catch {
            if (!appName.includes('\\') && !appName.includes('/')) {
              entries.push({
                id: randomUUID(),
                type: 'obsolete',
                keyPath: keyMatch[1],
                valueName: appName,
                issue: `File association references unregistered app: ${appName}`,
                risk: 'low',
                selected: true,
                fix: { op: 'delete-value' }
              })
            }
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for broken font references
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
        '/s'
      ], { timeout: 15000 })

      const winDir = process.env.WINDIR || 'C:\\Windows'
      const fontsDir = join(winDir, 'Fonts')
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+)/i)
        if (match) {
          const fontName = match[1].trim()
          let fontFile = match[2].trim()
          if (!fontFile.includes('\\') && !fontFile.includes('/')) {
            fontFile = join(fontsDir, fontFile)
          }
          if (fontFile && !existsSync(fontFile)) {
            entries.push({
              id: randomUUID(),
              type: 'invalid',
              keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
              valueName: fontName,
              issue: `Font file missing: ${fontFile}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for stale MUI Cache entries
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKCU\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
        '/s'
      ], { timeout: 15000 })

      const muiKey = 'HKCU\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache'
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(.+?\.exe(\.\w+))\s+REG_SZ\s+/i)
        if (match) {
          const fullValueName = match[1].trim()
          const exePath = fullValueName.replace(/\.\w+$/, '')
          if (exePath && exePath.includes('\\') && !existsSync(exePath)) {
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: muiKey,
              valueName: fullValueName,
              issue: `MUI cache references uninstalled program: ${exePath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for Windows Firewall rules pointing to missing programs
    try {
      const fwRulesKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules'
      const { stdout } = await execFileAsync('reg', [
        'query', fwRulesKey, '/s'
      ], { timeout: 15000 })

      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/REG_SZ\s+(.+)/i)
        if (match) {
          const ruleValue = match[1]
          const appMatch = ruleValue.match(/App=([^|]+)/i)
          if (appMatch) {
            const appPath = appMatch[1].trim()
            if (appPath && !appPath.startsWith('%') && appPath.includes('\\') && !existsSync(appPath)) {
              const nameMatch = line.match(/^\s+(.+?)\s+REG_SZ/i)
              entries.push({
                id: randomUUID(),
                type: 'obsolete',
                keyPath: fwRulesKey,
                valueName: nameMatch?.[1]?.trim() || 'Unknown Rule',
                issue: `Firewall rule for missing program: ${appPath}`,
                risk: 'low',
                selected: true,
                fix: { op: 'delete-value' }
              })
            }
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for broken context menu (shell) extensions
    const shellExtKeys = [
      'HKCR\\*\\shellex\\ContextMenuHandlers',
      'HKCR\\Directory\\shellex\\ContextMenuHandlers',
      'HKCR\\Folder\\shellex\\ContextMenuHandlers'
    ]
    for (const shellKey of shellExtKeys) {
      try {
        const { stdout } = await execFileAsync('reg', ['query', shellKey, '/s'], { timeout: 10000 })
        const blocks = stdout.split(/\r?\n\r?\n/)
        for (const block of blocks) {
          const clsidMatch = block.match(/\(Default\)\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
          if (clsidMatch) {
            const clsid = clsidMatch[1]
            try {
              const { stdout: clsidOut } = await execFileAsync('reg', [
                'query', `HKCR\\CLSID\\${clsid}\\InprocServer32`
              ], { timeout: 5000 })
              const dllMatch = clsidOut.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
              if (dllMatch) {
                const dllPath = dllMatch[1].trim().replace(/"/g, '')
                if (dllPath && !existsSync(dllPath)) {
                  const keyMatch = block.match(/^(HK[^\r\n]+)/m)
                  entries.push({
                    id: randomUUID(),
                    type: 'broken',
                    keyPath: keyMatch?.[1]?.trim() || shellKey,
                    valueName: clsid,
                    issue: `Context menu handler DLL missing: ${dllPath}`,
                    risk: 'medium',
                    selected: true,
                    fix: { op: 'delete-key' }
                  })
                }
              }
            } catch {
              const keyMatch = block.match(/^(HK[^\r\n]+)/m)
              entries.push({
                id: randomUUID(),
                type: 'orphaned',
                keyPath: keyMatch?.[1]?.trim() || shellKey,
                valueName: clsid,
                issue: `Context menu handler references missing COM object: ${clsid}`,
                risk: 'low',
                selected: true,
                fix: { op: 'delete-key' }
              })
            }
          }
        }
      } catch {
        // Skip
      }
    }

    // Scan for stale Windows Installer product references
    try {
      const installerKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\Folders'
      const { stdout } = await execFileAsync('reg', [
        'query', installerKey, '/s'
      ], { timeout: 15000 })

      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(.+?)\s+REG_SZ/i)
        if (match) {
          const folderPath = match[1].trim()
          if (folderPath && folderPath.length > 3 && !existsSync(folderPath)) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: installerKey,
              valueName: folderPath,
              issue: `Windows Installer references missing folder: ${folderPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for dead CLSID InprocServer32 entries
    try {
      const { stdout } = await execFileAsync('reg', [
        'query', 'HKCR\\CLSID', '/s', '/f', 'InprocServer32', '/k'
      ], { timeout: 20000 })

      const blocks = stdout.split(/\r?\n\r?\n/)
      let comCount = 0
      for (const block of blocks) {
        if (comCount >= 50) break
        const keyMatch = block.match(/^(HKCR\\CLSID\\(\{[^}]+\})\\InprocServer32)/m)
        const dllMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
        if (keyMatch && dllMatch) {
          const dllPath = dllMatch[1].trim().replace(/"/g, '')
          if (dllPath && dllPath.includes('\\') && !dllPath.startsWith('%') && !existsSync(dllPath)) {
            const parentClsidKey = `HKCR\\CLSID\\${keyMatch[2]}`
            entries.push({
              id: randomUUID(),
              type: 'broken',
              keyPath: keyMatch[1],
              valueName: '(Default)',
              issue: `COM object DLL missing: ${dllPath}`,
              risk: 'medium',
              selected: true,
              fix: { op: 'delete-key', key: parentClsidKey }
            })
            comCount++
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for stale TypeLib entries
    try {
      const { stdout } = await execFileAsync('reg', [
        'query', 'HKCR\\TypeLib', '/s', '/f', 'win32', '/k'
      ], { timeout: 15000 })

      const blocks = stdout.split(/\r?\n\r?\n/)
      let tlbCount = 0
      for (const block of blocks) {
        if (tlbCount >= 30) break
        const keyMatch = block.match(/^(HKCR\\TypeLib\\(\{[^}]+\})[^\r\n]*)/m)
        const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
        if (keyMatch && valMatch) {
          const tlbPath = valMatch[1].trim().replace(/"/g, '')
          if (tlbPath && tlbPath.includes('\\') && !tlbPath.startsWith('%') && !existsSync(tlbPath)) {
            const parentTypeLibKey = `HKCR\\TypeLib\\${keyMatch[2]}`
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch[1],
              valueName: '(Default)',
              issue: `Type library file missing: ${tlbPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key', key: parentTypeLibKey }
            })
            tlbCount++
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan for orphaned App Compatibility shim entries (HKLM)
    try {
      const appCompatKeyLM = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
      const { stdout } = await execFileAsync('reg', [
        'query', appCompatKeyLM, '/s'
      ], { timeout: 10000 })

      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_SZ\s+/i)
        if (match) {
          const appPath = match[1].trim()
          if (appPath && appPath.includes('\\') && !existsSync(appPath)) {
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: appCompatKeyLM,
              valueName: appPath,
              issue: `Compatibility shim for uninstalled app: ${appPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // Scan HKCU App Compat layers too
    try {
      const appCompatKeyCU = 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
      const { stdout } = await execFileAsync('reg', [
        'query', appCompatKeyCU, '/s'
      ], { timeout: 10000 })

      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_SZ\s+/i)
        if (match) {
          const appPath = match[1].trim()
          if (appPath && appPath.includes('\\') && !existsSync(appPath)) {
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: appCompatKeyCU,
              valueName: appPath,
              issue: `Compatibility shim for uninstalled app: ${appPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' }
            })
          }
        }
      }
    } catch {
      // Skip
    }

    // --- SECURITY VULNERABILITY SCANS ---
    // Security hardening checks

    // Check if UAC is disabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        '/v', 'EnableLUA'
      ], { timeout: 5000 })
      const match = stdout.match(/EnableLUA\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1] === '0') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
          valueName: 'EnableLUA',
          issue: 'User Account Control (UAC) is disabled — malware can run with admin privileges silently',
          risk: 'high',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' }
        })
      }
    } catch {
      // Skip
    }

    // Check if Windows Defender real-time protection is disabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
        '/v', 'DisableRealtimeMonitoring'
      ], { timeout: 5000 })
      const match = stdout.match(/DisableRealtimeMonitoring\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1] === '1') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
          valueName: 'DisableRealtimeMonitoring',
          issue: 'Windows Defender real-time protection is disabled via policy',
          risk: 'high',
          selected: true,
          fix: { op: 'delete-value' }
        })
      }
    } catch {
      // Key doesn't exist = not disabled, which is fine
    }

    // Check if Windows Defender is fully disabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender',
        '/v', 'DisableAntiSpyware'
      ], { timeout: 5000 })
      const match = stdout.match(/DisableAntiSpyware\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1] === '1') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender',
          valueName: 'DisableAntiSpyware',
          issue: 'Windows Defender antivirus is completely disabled via policy',
          risk: 'high',
          selected: true,
          fix: { op: 'delete-value' }
        })
      }
    } catch {
      // Skip
    }

    // Check if AutoRun is enabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
        '/v', 'NoDriveTypeAutoRun'
      ], { timeout: 5000 })
      const match = stdout.match(/NoDriveTypeAutoRun\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i)
      if (!match || parseInt(match[1], 16) < 0xff) {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
          valueName: 'NoDriveTypeAutoRun',
          issue: 'AutoRun is not fully disabled — removable drives can auto-execute malware',
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '255' }
        })
      }
    } catch {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
        valueName: 'NoDriveTypeAutoRun',
        issue: 'AutoRun is not disabled — removable drives can auto-execute malware',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '255' }
      })
    }

    // Check if SMBv1 is enabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
        '/v', 'SMB1'
      ], { timeout: 5000 })
      const match = stdout.match(/SMB1\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1] !== '0') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
          valueName: 'SMB1',
          issue: 'SMBv1 protocol is enabled — vulnerable to WannaCry and EternalBlue exploits',
          risk: 'high',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' }
        })
      }
    } catch {
      // Key missing — SMBv1 may still be enabled via feature
    }

    // Check if Remote Desktop is enabled without NLA
    try {
      const { stdout: rdpEnabled } = await execFileAsync('reg', [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server',
        '/v', 'fDenyTSConnections'
      ], { timeout: 5000 })
      const rdpMatch = rdpEnabled.match(/fDenyTSConnections\s+REG_DWORD\s+0x(\d+)/i)
      if (rdpMatch && rdpMatch[1] === '0') {
        try {
          const rdpNlaKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp'
          const { stdout: nlaOut } = await execFileAsync('reg', [
            'query', rdpNlaKey, '/v', 'UserAuthentication'
          ], { timeout: 5000 })
          const nlaMatch = nlaOut.match(/UserAuthentication\s+REG_DWORD\s+0x(\d+)/i)
          if (!nlaMatch || nlaMatch[1] === '0') {
            entries.push({
              id: randomUUID(),
              type: 'vulnerability',
              keyPath: rdpNlaKey,
              valueName: 'UserAuthentication',
              issue: 'Remote Desktop is enabled without Network Level Authentication (NLA)',
              risk: 'high',
              selected: true,
              fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' }
            })
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }

    // Check if Windows Script Host is enabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows Script Host\\Settings',
        '/v', 'Enabled'
      ], { timeout: 5000 })
      const match = stdout.match(/Enabled\s+REG_SZ\s+(\d+)/i)
      if (!match || match[1] !== '0') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows Script Host\\Settings',
          valueName: 'Enabled',
          issue: 'Windows Script Host is enabled — allows malicious .vbs/.js scripts to execute',
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_SZ', data: '0' }
        })
      }
    } catch {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows Script Host\\Settings',
        valueName: 'Enabled',
        issue: 'Windows Script Host is enabled — allows malicious .vbs/.js scripts to execute',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_SZ', data: '0' }
      })
    }

    // Check if PowerShell execution policy is unrestricted
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell',
        '/v', 'ExecutionPolicy'
      ], { timeout: 5000 })
      const match = stdout.match(/ExecutionPolicy\s+REG_SZ\s+(.+)/i)
      if (match) {
        const policy = match[1].trim().toLowerCase()
        if (policy === 'unrestricted' || policy === 'bypass') {
          entries.push({
            id: randomUUID(),
            type: 'vulnerability',
            keyPath: 'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell',
            valueName: 'ExecutionPolicy',
            issue: `PowerShell execution policy is "${match[1].trim()}" — scripts from any source can run`,
            risk: 'medium',
            selected: true,
            fix: { op: 'set-value', regType: 'REG_SZ', data: 'RemoteSigned' }
          })
        }
      }
    } catch {
      // Skip
    }

    // Check if Windows Firewall is disabled
    const fwProfiles = [
      { key: 'DomainProfile', label: 'Domain' },
      { key: 'StandardProfile', label: 'Private' },
      { key: 'PublicProfile', label: 'Public' }
    ]
    for (const profile of fwProfiles) {
      try {
        const fwKey = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\${profile.key}`
        const { stdout } = await execFileAsync('reg', [
          'query', fwKey, '/v', 'EnableFirewall'
        ], { timeout: 5000 })
        const match = stdout.match(/EnableFirewall\s+REG_DWORD\s+0x(\d+)/i)
        if (match && match[1] === '0') {
          entries.push({
            id: randomUUID(),
            type: 'vulnerability',
            keyPath: fwKey,
            valueName: 'EnableFirewall',
            issue: `Windows Firewall is disabled for ${profile.label} network profile`,
            risk: 'high',
            selected: true,
            fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' }
          })
        }
      } catch {
        // Skip
      }
    }

    // Check if Remote Registry service is enabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RemoteRegistry',
        '/v', 'Start'
      ], { timeout: 5000 })
      const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
      if (match && (match[1] === '2' || match[1] === '3')) {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RemoteRegistry',
          valueName: 'Start',
          issue: `Remote Registry service is ${match[1] === '2' ? 'set to auto-start' : 'enabled'} — allows remote registry access`,
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' }
        })
      }
    } catch {
      // Skip
    }

    // --- PERFORMANCE TWEAKS ---

    // Check if SysMain (Superfetch) is enabled
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
        '/v', 'Start'
      ], { timeout: 5000 })
      const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
      if (match && (match[1] === '2' || match[1] === '3')) {
        entries.push({
          id: randomUUID(),
          type: 'performance',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
          valueName: 'Start',
          issue: 'SysMain (Superfetch) is enabled — unnecessary on SSDs, causes disk thrashing on HDDs',
          risk: 'low',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' }
        })
      }
    } catch {
      // Skip
    }

    // --- NETWORK HARDENING ---

    // Check if LLMNR is enabled
    try {
      const llmnrKey = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient'
      const { stdout } = await execFileAsync('reg', [
        'query', llmnrKey, '/v', 'EnableMulticast'
      ], { timeout: 5000 })
      const match = stdout.match(/EnableMulticast\s+REG_DWORD\s+0x(\d+)/i)
      if (!match || match[1] !== '0') {
        entries.push({
          id: randomUUID(),
          type: 'network',
          keyPath: llmnrKey,
          valueName: 'EnableMulticast',
          issue: 'LLMNR is enabled — vulnerable to name resolution poisoning attacks on local networks',
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' }
        })
      }
    } catch {
      entries.push({
        id: randomUUID(),
        type: 'network',
        keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient',
        valueName: 'EnableMulticast',
        issue: 'LLMNR is enabled by default — vulnerable to name resolution poisoning attacks',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' }
      })
    }

    // Check if WPAD is not disabled
    try {
      const wpadKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Wpad'
      const { stdout } = await execFileAsync('reg', [
        'query', wpadKey, '/v', 'WpadOverride'
      ], { timeout: 5000 })
      const match = stdout.match(/WpadOverride\s+REG_DWORD\s+0x(\d+)/i)
      if (!match || match[1] !== '1') {
        entries.push({
          id: randomUUID(),
          type: 'network',
          keyPath: wpadKey,
          valueName: 'WpadOverride',
          issue: 'WPAD auto-proxy discovery is enabled — can be exploited for man-in-the-middle attacks',
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' }
        })
      }
    } catch {
      entries.push({
        id: randomUUID(),
        type: 'network',
        keyPath: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Wpad',
        valueName: 'WpadOverride',
        issue: 'WPAD auto-proxy discovery is enabled — can be exploited for man-in-the-middle attacks',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' }
      })
    }

    // --- SERVICES AUDIT ---
    // (DiagTrack, dmwappushservice, MapsBroker moved to Privacy Shield)

    // Check Fax service
    try {
      const { stdout } = await execFileAsync('reg', [
        'query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Fax', '/v', 'Start'
      ], { timeout: 5000 })
      const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
      if (match && (match[1] === '2' || match[1] === '3')) {
        entries.push({
          id: randomUUID(),
          type: 'service',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Fax',
          valueName: 'Start',
          issue: `Fax service is ${match[1] === '2' ? 'set to auto-start' : 'enabled'} — unnecessary on most machines`,
          risk: 'low',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' }
        })
      }
    } catch { /* Skip */ }

    // Check Print Spooler
    try {
      const { stdout } = await execFileAsync('reg', [
        'query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler', '/v', 'Start'
      ], { timeout: 5000 })
      const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1] === '2') {
        entries.push({
          id: randomUUID(),
          type: 'service',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler',
          valueName: 'Start',
          issue: 'Print Spooler is auto-starting — attack surface for PrintNightmare (disable if no printer)',
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' }
        })
      }
    } catch { /* Skip */ }

    // --- SCHEDULED TASKS CLEANUP ---
    // (MapsBroker moved to Privacy Shield)

    // Scan for orphaned scheduled tasks
    try {
      const { stdout } = await execFileAsync('schtasks', [
        '/query', '/fo', 'CSV', '/nh', '/v'
      ], { timeout: 20000 })

      const lines = stdout.split(/\r?\n/)
      const seen = new Set<string>()
      for (const line of lines) {
        // Parse CSV fields properly: handle escaped quotes ("") inside quoted fields
        const cols = parseCSVLine(line)
        // Verbose CSV: HostName(0), TaskName(1), ..., Task To Run(8), ...
        if (!cols || cols.length < 9) continue
        const taskName = cols[1]
        const taskToRun = cols[8].trim()

        if (!taskToRun || taskToRun === 'N/A' || taskToRun.startsWith('COM handler') || seen.has(taskName)) continue
        seen.add(taskName)

        const exeMatch = taskToRun.match(/^"?([^"]+\.\w{2,4})"?/)
        if (exeMatch) {
          const exePath = exeMatch[1].trim()
          if (exePath.includes('\\') && !exePath.toLowerCase().startsWith('c:\\windows\\') &&
              !exePath.startsWith('%') && !existsSync(exePath)) {
            entries.push({
              id: randomUUID(),
              type: 'task',
              keyPath: taskName,
              valueName: 'Task To Run',
              issue: `Scheduled task points to missing executable: ${exePath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-task' }
            })
          }
        }
      }
    } catch { /* Skip */ }

    // (Telemetry scheduled tasks moved to Privacy Shield)

    // Detect orphaned third-party update tasks
    const thirdPartyTasks = [
      { pattern: 'Adobe Acrobat Update', exe: 'AdobeARM.exe' },
      { pattern: 'Adobe Flash Player', exe: 'FlashPlayerUpdateService.exe' },
      { pattern: 'JavaUpdateSched', exe: 'jusched.exe' },
      { pattern: 'GoogleUpdate', exe: 'GoogleUpdate.exe' },
      { pattern: 'CCleaner', exe: 'CCleaner' }
    ]
    try {
      const { stdout } = await execFileAsync('schtasks', ['/query', '/fo', 'CSV', '/nh'], { timeout: 15000 })
      for (const task of thirdPartyTasks) {
        const matchingLines = stdout.split(/\r?\n/).filter(l => l.includes(task.pattern))
        for (const line of matchingLines) {
          const cols = parseCSVLine(line)
          if (cols && cols.length >= 1) {
            const taskName = cols[0]
            entries.push({
              id: randomUUID(),
              type: 'task',
              keyPath: taskName,
              valueName: 'Scheduled Task',
              issue: `Third-party update task "${task.pattern}" — may be for uninstalled software`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-task' }
            })
          }
        }
      }
    } catch { /* Skip */ }

    // Store entries in a new scan session
    const sessionMap = new Map<string, RegistryEntry>()
    for (const entry of entries) {
      sessionMap.set(entry.id, entry)
    }
    const scanId = randomUUID()
    scanSessions.set(scanId, sessionMap)
    activeScanId = scanId

    // Clean up old sessions (keep only last 3)
    const sessionKeys = [...scanSessions.keys()]
    while (sessionKeys.length > 3) {
      scanSessions.delete(sessionKeys.shift()!)
    }

    return entries
  })

  ipcMain.handle(IPC.REGISTRY_FIX, async (_event, entryIds: string[]): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> => {
    const total = entryIds.length
    const sendProgress = (current: number, currentEntry: string) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.REGISTRY_FIX_PROGRESS, { current, total, currentEntry })
    }

    // Create backup first
    sendProgress(0, 'Creating registry backup...')
    const backupDir = join(homedir(), 'Documents', 'DustForge Backups')
    try {
      const { mkdirSync } = await import('fs')
      mkdirSync(backupDir, { recursive: true })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = join(backupDir, `registry-backup-${timestamp}.reg`)
      await execFileAsync('reg', ['export', 'HKLM\\SOFTWARE', backupPath, '/y'], { timeout: 30000 })
    } catch {
      // Backup failed, but continue
    }

    let fixed = 0
    let failed = 0
    const failures: { issue: string; reason: string }[] = []
    const session = scanSessions.get(activeScanId)

    for (let i = 0; i < entryIds.length; i++) {
      const entry = session?.get(entryIds[i])
      if (!entry || !entry.fix) {
        failed++
        failures.push({ issue: 'Unknown entry', reason: 'Entry data not found — try scanning again before fixing' })
        continue
      }

      const fix = entry.fix
      const key = fix.key || entry.keyPath
      const value = fix.value || entry.valueName

      sendProgress(i + 1, `Fixing: ${entry.issue.substring(0, 80)}...`)

      try {
        switch (fix.op) {
          case 'delete-value':
            await execFileAsync('reg', ['delete', key, '/v', value, '/f'], { timeout: 10000 })
            break

          case 'delete-key':
            await execFileAsync('reg', ['delete', key, '/f'], { timeout: 10000 })
            break

          case 'set-value':
            if (fix.regType && fix.data !== undefined) {
              await execFileAsync('reg', [
                'add', key, '/v', value, '/t', fix.regType, '/d', fix.data, '/f'
              ], { timeout: 10000 })
            }
            break

          case 'disable-task': {
            // Use PowerShell — schtasks /change fails for system-owned tasks
            // Split full path into TaskPath + TaskName for PowerShell
            const disableParts = splitTaskPath(entry.keyPath)
            if (!disableParts) throw new Error('Invalid task path')
            const safeDisablePath = disableParts.path.replace(/'/g, "''")
            const safeDisableName = disableParts.name.replace(/'/g, "''")
            await execFileAsync('powershell', [
              '-NoProfile', '-NonInteractive', '-Command',
              `Disable-ScheduledTask -TaskPath '${safeDisablePath}' -TaskName '${safeDisableName}' -ErrorAction Stop`
            ], { timeout: 10000 })
            break
          }

          case 'delete-task': {
            const deleteParts = splitTaskPath(entry.keyPath)
            if (!deleteParts) throw new Error('Invalid task path')
            const safeDeletePath = deleteParts.path.replace(/'/g, "''")
            const safeDeleteName = deleteParts.name.replace(/'/g, "''")
            await execFileAsync('powershell', [
              '-NoProfile', '-NonInteractive', '-Command',
              `Unregister-ScheduledTask -TaskPath '${safeDeletePath}' -TaskName '${safeDeleteName}' -Confirm:$false -ErrorAction Stop`
            ], { timeout: 10000 })
            break
          }
        }
        fixed++
      } catch (err: any) {
        const stderr = err?.stderr || err?.message || 'Unknown error'
        const reason = stderr.includes('Access is denied') ? 'Access denied — run as administrator'
          : stderr.includes('cannot find') || stderr.includes('does not exist') ? 'Key or value no longer exists'
          : stderr.includes('network') ? 'Network error'
          : stderr.toString().split(/\r?\n/)[0].substring(0, 120) || 'Unknown error'
        failed++
        failures.push({ issue: entry.issue, reason })
      }
    }

    sendProgress(total, 'Done')
    return { fixed, failed, failures }
  })
}
