import { app } from 'electron'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { scanDirectory, scanFile, scanMultipleDirectories, scanDirectoriesAsItems, cleanItems, getDirectorySize } from './services/file-utils'
import { cacheItems } from './services/scan-cache'
import { CleanerType } from '../shared/enums'
import type { ScanResult, CleanResult } from '../shared/types'
import { SYSTEM_PATHS, BROWSER_PATHS, APP_PATHS, GAMING_PATHS, GPU_CACHE_PATHS } from './constants/paths'
import { randomUUID } from 'crypto'

// ─── Output helpers ──────────────────────────────────────────

function log(msg: string): void {
  process.stdout.write(msg + '\n')
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

function out(data: unknown, json: boolean): void {
  if (json) {
    log(JSON.stringify(data, null, 2))
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') log(`  ${item}`)
      else log(`  ${JSON.stringify(item)}`)
    }
  } else if (typeof data === 'object' && data !== null) {
    for (const [k, v] of Object.entries(data)) {
      log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    }
  } else {
    log(String(data))
  }
}

// ─── Legacy scan implementations (file-based cleaners) ───────

async function scanSystem(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.System
  const targets = [
    { path: SYSTEM_PATHS.userTemp, subcategory: 'User Temp Files' },
    { path: SYSTEM_PATHS.systemTemp, subcategory: 'System Temp Files' },
    { path: SYSTEM_PATHS.prefetch, subcategory: 'Prefetch Data' },
    { path: SYSTEM_PATHS.windowsLogs, subcategory: 'Windows Logs' },
    { path: SYSTEM_PATHS.setupLogs, subcategory: 'Setup Logs' },
    { path: SYSTEM_PATHS.thumbnailCache, subcategory: 'Thumbnail & Icon Cache' },
    { path: SYSTEM_PATHS.fontCache, subcategory: 'Font Cache' },
    { path: SYSTEM_PATHS.dxShaderCache, subcategory: 'DirectX Shader Cache' },
    { path: SYSTEM_PATHS.inetCache, subcategory: 'Internet Cache' },
    { path: SYSTEM_PATHS.windowsUpdateCache, subcategory: 'Windows Update Cache' },
    { path: SYSTEM_PATHS.deliveryOptimization, subcategory: 'Delivery Optimization Cache' },
    { path: SYSTEM_PATHS.errorReports, subcategory: 'Error Reports' },
    { path: SYSTEM_PATHS.systemErrorReports, subcategory: 'System Error Reports' },
    { path: SYSTEM_PATHS.crashDumps, subcategory: 'Crash Dumps' },
    { path: SYSTEM_PATHS.memoryDumps, subcategory: 'Minidump Files' },
    { path: SYSTEM_PATHS.installerPatchCache, subcategory: 'Installer Patch Cache' },
    { path: SYSTEM_PATHS.eventLogs, subcategory: 'Event Log Archives' },
    { path: SYSTEM_PATHS.defenderScanHistory, subcategory: 'Defender Scan History' },
    { path: SYSTEM_PATHS.windowsOld, subcategory: 'Previous Windows Installation' },
  ]
  const protectedEventLogs = [
    'microsoft-windows-diagnostics-performance%4operational.evtx',
    'security.evtx', 'system.evtx', 'application.evtx', 'setup.evtx',
    'microsoft-windows-windows defender%4operational.evtx',
  ]
  for (const target of targets) {
    try {
      const result = await scanDirectory(target.path, category, target.subcategory)
      if (target.path === SYSTEM_PATHS.eventLogs) {
        result.items = result.items.filter((item) => {
          const fileName = item.path.split(/[\\/]/).pop()?.toLowerCase() || ''
          return !protectedEventLogs.some((p) => fileName === p)
        })
        result.totalSize = result.items.reduce((s, item) => s + item.size, 0)
        result.itemCount = result.items.length
      }
      if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
    } catch { /* skip */ }
  }
  try {
    const dumpResult = await scanFile(SYSTEM_PATHS.fullMemoryDump, category, 'Full Memory Dump')
    if (dumpResult.items.length > 0) { cacheItems(dumpResult.items); results.push(dumpResult) }
  } catch { /* skip */ }
  return results
}

async function scanBrowserCli(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.Browser
  const chromiumBrowsers = [
    { label: 'Chrome', ...BROWSER_PATHS.chrome, hasProfiles: true },
    { label: 'Edge', ...BROWSER_PATHS.edge, hasProfiles: true },
    { label: 'Brave', ...BROWSER_PATHS.brave, hasProfiles: true },
    { label: 'Vivaldi', ...BROWSER_PATHS.vivaldi, hasProfiles: true },
    { label: 'Opera', ...BROWSER_PATHS.opera, hasProfiles: false },
    { label: 'Opera GX', ...BROWSER_PATHS.operaGX, hasProfiles: false },
  ]
  for (const browser of chromiumBrowsers) {
    if (!existsSync(browser.base)) continue
    if (browser.hasProfiles) {
      const profiles = await getChromiumProfiles(browser.base)
      for (const profile of profiles) {
        for (const { dir, label } of [
          { dir: browser.cache, label: 'Cache' }, { dir: browser.codeCache, label: 'Code Cache' },
          { dir: browser.gpuCache, label: 'GPU Cache' }, { dir: browser.serviceWorker, label: 'Service Worker Cache' },
        ]) {
          const cachePath = join(browser.base, profile, dir)
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `${browser.label} - ${profile} ${label}`)
            if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
          }
        }
      }
    } else {
      for (const { dir, label } of [
        { dir: browser.cache, label: 'Cache' }, { dir: browser.codeCache, label: 'Code Cache' },
        { dir: browser.gpuCache, label: 'GPU Cache' }, { dir: browser.serviceWorker, label: 'Service Worker Cache' },
      ]) {
        const cachePath = join(browser.base, dir)
        if (existsSync(cachePath)) {
          const result = await scanDirectory(cachePath, category, `${browser.label} - ${label}`)
          if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
        }
      }
    }
  }
  if (existsSync(BROWSER_PATHS.firefox.cache)) {
    try {
      const profileDirs = await readdir(BROWSER_PATHS.firefox.cache, { withFileTypes: true })
      for (const dir of profileDirs) {
        if (dir.isDirectory()) {
          const cachePath = join(BROWSER_PATHS.firefox.cache, dir.name, 'cache2', 'entries')
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `Firefox - ${dir.name} Cache`)
            if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
          }
        }
      }
    } catch { /* skip */ }
  }
  return results
}

async function scanApp(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.App
  for (const appDef of APP_PATHS) {
    try {
      const result = await scanMultipleDirectories(appDef.paths, category, appDef.name)
      if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
    } catch { /* skip */ }
  }
  return results
}

async function scanGaming(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.Gaming
  for (const launcher of GAMING_PATHS) {
    try {
      const result = await scanDirectoriesAsItems(launcher.paths, category, launcher.name, 'Launcher Caches')
      if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
    } catch { /* skip */ }
  }
  for (const gpu of GPU_CACHE_PATHS) {
    try {
      const result = await scanDirectoriesAsItems(gpu.paths, category, gpu.name, 'GPU Shader Caches')
      if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
    } catch { /* skip */ }
  }
  return results
}

async function scanRecycleBin(): Promise<ScanResult[]> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-Command',
      `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`
    ])
    const [countStr, sizeStr] = stdout.trim().split('|')
    const count = parseInt(countStr) || 0
    const size = parseInt(sizeStr) || 0
    if (count === 0) return []
    const item = { id: randomUUID(), path: 'Recycle Bin', size, category: CleanerType.RecycleBin, subcategory: 'Recycle Bin', lastModified: Date.now(), selected: true }
    cacheItems([item])
    return [{ category: CleanerType.RecycleBin, subcategory: 'Recycle Bin', items: [item], totalSize: size, itemCount: count }]
  } catch { return [] }
}

async function cleanRecycleBin(sizeBytes: number = 0): Promise<CleanResult> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `$shell = New-Object -ComObject Shell.Application; $shell.NameSpace(0x0a).Items() | ForEach-Object { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }; Clear-RecycleBin -Force -Confirm:$false -ErrorAction SilentlyContinue`
    ])
    return { totalCleaned: sizeBytes, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
  } catch (err: any) {
    return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [{ path: 'Recycle Bin', reason: err.message }], needsElevation: false }
  }
}

async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) profiles.push(entry.name)
    }
  } catch { /* skip */ }
  return profiles
}

// ─── Help text ───────────────────────────────────────────────

function printHelp(): void {
  log(`
DustForge CLI — Full-featured command line interface

Usage:
  dustforge --cli <command> [subcommand] [options]

File Cleaners (legacy flags also supported):
  scan [--system] [--browser] [--app] [--gaming] [--recycle-bin] [--all]
  clean [--system] [--browser] [--app] [--gaming] [--recycle-bin] [--all]

Registry:
  registry scan              Scan for registry issues
  registry fix [--all]       Fix found registry issues

Startup Manager:
  startup list               List startup items
  startup boot-trace         Show boot time trace
  startup disable <name>     Disable a startup item
  startup enable <name>      Enable a startup item
  startup delete <name>      Delete a startup item

Debloater:
  debloat scan               Scan for removable bloatware
  debloat remove <pkg,...>   Remove specified packages (comma-separated)
  debloat remove --all       Remove all detected bloatware

Disk Analyzer:
  disk drives                List available drives
  disk analyze <drive>       Analyze disk usage (e.g. disk analyze C)

Network Cleanup:
  network scan               Scan DNS cache, Wi-Fi profiles, ARP cache
  network clean [--all]      Clean selected network items

Malware Scanner:
  malware scan               Scan for malware threats
  malware quarantine <path>  Quarantine a detected file
  malware delete <path>      Delete a detected file

Privacy Shield:
  privacy scan               Scan privacy settings
  privacy apply [--all]      Apply recommended privacy settings

Driver Manager:
  drivers scan               Scan for old/unused driver packages
  drivers clean <name,...>   Remove specified driver packages
  drivers check-updates      Check for driver updates
  drivers update [--all]     Install driver updates

Service Manager:
  services scan              Scan Windows services
  services disable <name>    Set service to disabled
  services manual <name>     Set service to manual start

Program Uninstaller:
  programs list              List installed programs

Software Updater:
  updates check              Check for software updates (via winget)
  updates run <id,...>       Update specified apps
  updates run --all          Update all available apps

Performance Monitor:
  perf info                  Show system information
  perf disk-health           Show disk S.M.A.R.T. health
  perf kill <pid>            Kill a process by PID

Uninstall Leftovers:
  leftovers scan             Scan for uninstall leftovers
  leftovers clean            Clean found leftovers

Scan History:
  history list               Show scan history
  history clear              Clear scan history

Restore Points:
  restore-point create [description]   Create a system restore point

Global Options:
  --json          Output as JSON
  --all           Select all items for action commands
  -h, --help      Show this help
  -v, --version   Show version

Examples:
  dustforge --cli scan --all --clean        Scan & clean all file categories
  dustforge --cli registry scan --json      Scan registry, JSON output
  dustforge --cli debloat scan              List removable bloatware
  dustforge --cli startup list              Show startup items
  dustforge --cli malware scan              Run malware scan
  dustforge --cli perf info                 Show system specs
`.trim())
}

// ─── Subcommand handlers ─────────────────────────────────────

async function handleRegistry(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanRegistry, fixRegistryEntries } = await import('./ipc/registry-cleaner.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning registry...')
    const entries = await scanRegistry()
    if (json) {
      out({ entries, count: entries.length }, true)
    } else {
      log(`Found ${entries.length} registry issues`)
      for (const e of entries) log(`  [${e.risk}] ${e.keyPath} — ${e.issue}`)
    }
  } else if (sub === 'fix') {
    if (!json) log('Scanning registry...')
    const entries = await scanRegistry()
    if (entries.length === 0) {
      out(json ? { message: 'No issues found' } : 'No registry issues found.', json)
      return
    }
    const toFix = args.includes('--all') ? entries : entries.filter(e => e.risk === 'high')
    if (!json) log(`Fixing ${toFix.length} of ${entries.length} issues...`)
    const result = await fixRegistryEntries(toFix, (current, total) => {
      if (!json) process.stdout.write(`\r  Progress: ${current}/${total}`)
    })
    if (!json) log('')
    out(result, json)
  } else {
    log('Usage: dustforge --cli registry <scan|fix> [--all] [--json]')
  }
}

async function handleStartup(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { listStartupItems, toggleStartupItem, deleteStartupItem, getBootTrace } = await import('./ipc/startup-manager.ipc')

  if (sub === 'list') {
    const items = await listStartupItems()
    if (json) {
      out(items, true)
    } else {
      log(`Found ${items.length} startup items`)
      for (const item of items) {
        const status = item.enabled ? 'enabled' : 'disabled'
        log(`  [${status}] ${item.displayName || item.name} — ${item.impact || 'unknown'} impact`)
      }
    }
  } else if (sub === 'boot-trace') {
    const trace = await getBootTrace()
    out(trace, json)
  } else if (sub === 'disable' || sub === 'enable') {
    const name = args.slice(1).join(' ')
    if (!name) { log(`Usage: dustforge --cli startup ${sub} <name>`); return }
    const items = await listStartupItems()
    const item = items.find(i => i.name === name || i.displayName === name)
    if (!item) { log(`Startup item not found: ${name}`); return }
    const enabled = sub === 'enable'
    const result = await toggleStartupItem(item.name, item.location, item.command, item.source, enabled)
    out(result, json)
  } else if (sub === 'delete') {
    const name = args.slice(1).join(' ')
    if (!name) { log('Usage: dustforge --cli startup delete <name>'); return }
    const items = await listStartupItems()
    const item = items.find(i => i.name === name || i.displayName === name)
    if (!item) { log(`Startup item not found: ${name}`); return }
    const result = await deleteStartupItem(item.name, item.location, item.source)
    out(result, json)
  } else {
    log('Usage: dustforge --cli startup <list|boot-trace|disable|enable|delete> [name]')
  }
}

async function handleDebloat(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanBloatware, removeBloatware } = await import('./ipc/debloater.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning for bloatware...')
    const apps = await scanBloatware()
    if (json) {
      out({ apps, count: apps.length }, true)
    } else {
      log(`Found ${apps.length} removable apps`)
      for (const a of apps) log(`  ${a.name} (${a.packageName}) — ${a.size} — ${a.description}`)
    }
  } else if (sub === 'remove') {
    const allFlag = args.includes('--all')
    if (allFlag) {
      if (!json) log('Scanning for bloatware...')
      const apps = await scanBloatware()
      if (apps.length === 0) { out(json ? { message: 'No bloatware found' } : 'No bloatware found.', json); return }
      const packageNames = apps.map(a => a.packageName)
      if (!json) log(`Removing ${packageNames.length} apps...`)
      const result = await removeBloatware(packageNames, (current, total, currentApp, status) => {
        if (!json) log(`  [${current}/${total}] ${currentApp}: ${status}`)
      })
      out(result, json)
    } else {
      const pkgArg = args.find(a => a !== 'remove' && !a.startsWith('--'))
      if (!pkgArg) { log('Usage: dustforge --cli debloat remove <pkg1,pkg2,...> or --all'); return }
      const packageNames = pkgArg.split(',').map(s => s.trim()).filter(Boolean)
      if (!json) log(`Removing ${packageNames.length} apps...`)
      const result = await removeBloatware(packageNames, (current, total, currentApp, status) => {
        if (!json) log(`  [${current}/${total}] ${currentApp}: ${status}`)
      })
      out(result, json)
    }
  } else {
    log('Usage: dustforge --cli debloat <scan|remove> [packages|--all]')
  }
}

async function handleDisk(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { getDrives, analyzeDisk, getFileTypes } = await import('./ipc/disk-analyzer.ipc')

  if (sub === 'drives') {
    const drives = await getDrives()
    if (json) {
      out(drives, true)
    } else {
      for (const d of drives) log(`  ${d.letter}: ${d.label || 'Local Disk'} — ${formatBytes(d.usedSpace)} / ${formatBytes(d.totalSize)} (${(d.usedSpace / d.totalSize * 100).toFixed(1)}% used)`)
    }
  } else if (sub === 'analyze') {
    const drive = args[1]?.replace(':', '')
    if (!drive) { log('Usage: dustforge --cli disk analyze <drive-letter>'); return }
    if (!json) log(`Analyzing drive ${drive}:...`)
    const tree = await analyzeDisk(drive)
    if (json) {
      out(tree, true)
    } else {
      const printNode = (node: any, depth: number): void => {
        if (depth > 2) return
        log(`${'  '.repeat(depth + 1)}${node.name} — ${formatBytes(node.size)}`)
        if (node.children) for (const child of node.children.slice(0, 10)) printNode(child, depth + 1)
      }
      printNode(tree, 0)
    }
  } else if (sub === 'file-types') {
    const drive = args[1]?.replace(':', '')
    if (!drive) { log('Usage: dustforge --cli disk file-types <drive-letter>'); return }
    if (!json) log(`Analyzing file types on ${drive}:...`)
    const types = await getFileTypes(drive)
    if (json) {
      out(types, true)
    } else {
      for (const t of types) log(`  ${t.extension}: ${t.fileCount} files, ${formatBytes(t.totalSize)}`)
    }
  } else {
    log('Usage: dustforge --cli disk <drives|analyze|file-types> [drive-letter]')
  }
}

async function handleNetwork(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanNetwork, cleanNetworkItems } = await import('./ipc/network-cleanup.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning network...')
    const items = await scanNetwork()
    if (json) {
      out({ items, count: items.length }, true)
    } else {
      log(`Found ${items.length} network items`)
      for (const item of items) log(`  [${item.type}] ${item.label} — ${item.detail}`)
    }
  } else if (sub === 'clean') {
    if (!json) log('Scanning network...')
    const items = await scanNetwork()
    if (items.length === 0) { out(json ? { message: 'Nothing to clean' } : 'No network items found.', json); return }
    const toClean = args.includes('--all') ? items : items.filter(i => i.selected)
    if (!json) log(`Cleaning ${toClean.length} items...`)
    const result = await cleanNetworkItems(toClean)
    out(result, json)
  } else {
    log('Usage: dustforge --cli network <scan|clean> [--all]')
  }
}

async function handleMalware(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanMalware, quarantineMalware, deleteMalware } = await import('./ipc/malware-scanner.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning for malware...')
    const result = await scanMalware((progress) => {
      if (!json) process.stdout.write(`\r  Scanning: ${progress.currentPath || '...'}`)
    })
    if (!json) log('')
    if (json) {
      out({ threats: result.threats, count: result.threats.length }, true)
    } else {
      log(`Found ${result.threats.length} threats`)
      for (const t of result.threats) log(`  [${t.severity}] ${t.fileName} — ${t.path}`)
    }
  } else if (sub === 'quarantine') {
    const path = args.slice(1).filter(a => !a.startsWith('--')).join(' ')
    if (!path) { log('Usage: dustforge --cli malware quarantine <path>'); return }
    const result = await quarantineMalware([path])
    out(result, json)
  } else if (sub === 'delete') {
    const path = args.slice(1).filter(a => !a.startsWith('--')).join(' ')
    if (!path) { log('Usage: dustforge --cli malware delete <path>'); return }
    const result = await deleteMalware([path])
    out(result, json)
  } else {
    log('Usage: dustforge --cli malware <scan|quarantine|delete> [path]')
  }
}

async function handlePrivacy(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanPrivacy, applyPrivacySettings } = await import('./ipc/privacy-shield.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning privacy settings...')
    const result = await scanPrivacy()
    if (json) {
      out({ settings: result.settings, count: result.settings.length }, true)
    } else {
      log(`Found ${result.settings.length} privacy settings`)
      for (const s of result.settings) {
        const status = s.enabled ? 'ON' : 'OFF'
        log(`  [${status}] ${s.label} — ${s.description}`)
      }
    }
  } else if (sub === 'apply') {
    if (!json) log('Scanning privacy settings...')
    const scanResult = await scanPrivacy()
    const toApply = args.includes('--all')
      ? scanResult.settings.map(s => s.id)
      : scanResult.settings.filter(s => !s.enabled).map(s => s.id)
    if (toApply.length === 0) { out(json ? { message: 'Nothing to apply' } : 'All recommended settings already applied.', json); return }
    if (!json) log(`Applying ${toApply.length} privacy settings...`)
    const applyResult = await applyPrivacySettings(toApply)
    out(applyResult, json)
  } else {
    log('Usage: dustforge --cli privacy <scan|apply> [--all]')
  }
}

async function handleDrivers(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanDrivers, cleanDrivers, scanDriverUpdates, installDriverUpdates } = await import('./ipc/driver-manager.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning driver packages...')
    const result = await scanDrivers((progress) => {
      if (!json) process.stdout.write(`\r  ${progress}`)
    })
    if (!json) log('')
    if (json) {
      out({ packages: result.packages, count: result.packages.length }, true)
    } else {
      log(`Found ${result.packages.length} driver packages`)
      for (const p of result.packages) log(`  ${p.publishedName} — ${p.className} — ${p.version}`)
    }
  } else if (sub === 'clean') {
    const nameArg = args.find(a => a !== 'clean' && !a.startsWith('--'))
    if (!nameArg) { log('Usage: dustforge --cli drivers clean <name1,name2,...>'); return }
    const names = nameArg.split(',').map(s => s.trim()).filter(Boolean)
    if (!json) log(`Removing ${names.length} driver packages...`)
    const result = await cleanDrivers(names)
    out(result, json)
  } else if (sub === 'check-updates') {
    if (!json) log('Checking for driver updates...')
    const updateResult = await scanDriverUpdates((progress) => {
      if (!json) process.stdout.write(`\r  ${progress}`)
    })
    if (!json) log('')
    if (json) {
      out({ updates: updateResult.updates, count: updateResult.updates.length }, true)
    } else {
      log(`Found ${updateResult.updates.length} driver updates`)
      for (const u of updateResult.updates) log(`  ${u.updateTitle}`)
    }
  } else if (sub === 'update') {
    if (!json) log('Checking for driver updates...')
    const updateResult = await scanDriverUpdates()
    if (updateResult.updates.length === 0) { out(json ? { message: 'No updates available' } : 'Drivers are up to date.', json); return }
    const toInstall = args.includes('--all')
      ? updateResult.updates.map(u => u.updateId)
      : (() => {
          const idArg = args.find(a => a !== 'update' && !a.startsWith('--'))
          return idArg ? idArg.split(',').map(s => s.trim()).filter(Boolean) : []
        })()
    if (toInstall.length === 0) { log('Usage: dustforge --cli drivers update <id,...> or --all'); return }
    if (!json) log(`Installing ${toInstall.length} driver updates...`)
    const result = await installDriverUpdates(toInstall, (progress) => {
      if (!json) process.stdout.write(`\r  ${progress}`)
    })
    if (!json) log('')
    out(result, json)
  } else {
    log('Usage: dustforge --cli drivers <scan|clean|check-updates|update> [names|--all]')
  }
}

async function handleServices(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanServices, applyServiceChanges } = await import('./ipc/service-manager.ipc')

  if (sub === 'scan') {
    if (!json) log('Scanning services...')
    const result = await scanServices()
    if (json) {
      out({ services: result.services, count: result.services.length }, true)
    } else {
      log(`Found ${result.services.length} optimizable services`)
      for (const s of result.services) log(`  [${s.startType}] ${s.displayName} (${s.name}) — ${s.description || ''}`)
    }
  } else if (sub === 'disable' || sub === 'manual') {
    const name = args.slice(1).filter(a => !a.startsWith('--')).join(' ')
    if (!name) { log(`Usage: dustforge --cli services ${sub} <service-name>`); return }
    const targetType = sub === 'disable' ? 'Disabled' : 'Manual'
    if (!json) log(`Setting ${name} to ${targetType}...`)
    const result = await applyServiceChanges([{ name, targetStartType: targetType }])
    out(result, json)
  } else {
    log('Usage: dustforge --cli services <scan|disable|manual> [service-name]')
  }
}

async function handlePrograms(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { getInstalledProgramsFull } = await import('./services/program-uninstaller')

  if (sub === 'list') {
    if (!json) log('Loading installed programs...')
    const programs = await getInstalledProgramsFull()
    if (json) {
      out({ programs, count: programs.length }, true)
    } else {
      log(`Found ${programs.length} installed programs`)
      for (const p of programs) log(`  ${p.displayName} ${p.displayVersion || ''} — ${p.publisher || 'Unknown publisher'} — ${p.estimatedSize ? formatBytes(p.estimatedSize * 1024) : ''}`)
    }
  } else {
    log('Usage: dustforge --cli programs list')
  }
}

async function handleUpdates(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { checkForUpdates, runUpdates } = await import('./services/software-updater')

  if (sub === 'check') {
    if (!json) log('Checking for software updates...')
    const result = await checkForUpdates()
    if (json) {
      out(result, true)
    } else {
      if (!result.wingetAvailable) { log('  winget is not available on this system'); return }
      log(`Found ${result.apps.length} available updates, ${result.upToDate.length} up to date`)
      for (const a of result.apps) log(`  ${a.name}: ${a.currentVersion} → ${a.availableVersion} (${a.severity})`)
    }
  } else if (sub === 'run') {
    if (!json) log('Checking for software updates...')
    const check = await checkForUpdates()
    if (check.apps.length === 0) { out(json ? { message: 'Everything up to date' } : 'All software is up to date.', json); return }
    const allFlag = args.includes('--all')
    const toUpdate = allFlag
      ? check.apps.map(a => a.id)
      : (() => {
          const idArg = args.find(a => a !== 'run' && !a.startsWith('--'))
          return idArg ? idArg.split(',').map(s => s.trim()).filter(Boolean) : []
        })()
    if (toUpdate.length === 0) { log('Usage: dustforge --cli updates run <id,...> or --all'); return }
    if (!json) log(`Updating ${toUpdate.length} apps...`)
    const result = await runUpdates(toUpdate, (progress) => {
      if (!json) log(`  [${progress.current}/${progress.total}] ${progress.currentApp}: ${progress.status}`)
    })
    out(result, json)
  } else {
    log('Usage: dustforge --cli updates <check|run> [ids|--all]')
  }
}

async function handlePerf(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { PerfMonitorService } = await import('./services/perf-monitor')
  const perf = new PerfMonitorService()

  if (sub === 'info') {
    const info = await perf.getSystemInfo()
    if (json) {
      out(info, true)
    } else {
      log(`  CPU: ${info.cpuModel} (${info.cpuCores}C/${info.cpuThreads}T)`)
      log(`  RAM: ${formatBytes(info.totalMemBytes)}`)
      log(`  OS:  ${info.osVersion}`)
      log(`  Host: ${info.hostname}`)
    }
  } else if (sub === 'disk-health') {
    if (!json) log('Checking disk health...')
    const disks = await perf.getDiskHealth()
    if (json) {
      out(disks, true)
    } else {
      for (const d of disks) {
        log(`  ${d.model} (${d.type}) — ${d.healthStatus}`)
        if (d.temperature) log(`    Temperature: ${d.temperature}°C`)
        if (d.remainingLife !== null) log(`    Remaining life: ${d.remainingLife}%`)
        if (d.powerOnHours !== null) log(`    Power-on hours: ${d.powerOnHours}`)
      }
    }
  } else if (sub === 'kill') {
    const pid = parseInt(args[1])
    if (isNaN(pid)) { log('Usage: dustforge --cli perf kill <pid>'); return }
    const result = await perf.killProcess(pid)
    out(result, json)
  } else {
    log('Usage: dustforge --cli perf <info|disk-health|kill> [pid]')
  }
}

async function handleLeftovers(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { scanForLeftovers } = await import('./services/uninstall-leftovers')

  if (sub === 'scan' || sub === 'clean') {
    if (!json) log('Scanning for uninstall leftovers...')
    const results = await scanForLeftovers(() => null)
    const totalItems = results.reduce((s, r) => s + r.itemCount, 0)
    const totalSize = results.reduce((s, r) => s + r.totalSize, 0)
    if (json && sub === 'scan') {
      out({ results, totalItems, totalSize }, true)
    } else if (sub === 'scan') {
      log(`Found ${totalItems} leftover items (${formatBytes(totalSize)})`)
      for (const r of results) log(`  ${r.subcategory}: ${r.itemCount} items, ${formatBytes(r.totalSize)}`)
    }
    if (sub === 'clean') {
      if (totalItems === 0) { out(json ? { message: 'No leftovers found' } : 'No leftovers found.', json); return }
      if (!json) log(`Cleaning ${totalItems} items (${formatBytes(totalSize)})...`)
      const itemIds = results.flatMap(r => r.items.map(i => i.id))
      const cleanResult = await cleanItems(itemIds)
      out(cleanResult, json)
    }
  } else {
    log('Usage: dustforge --cli leftovers <scan|clean>')
  }
}

async function handleHistory(args: string[], json: boolean): Promise<void> {
  const sub = args[0]
  const { getHistory, clearHistory } = await import('./services/history-store')

  if (sub === 'list') {
    const history = getHistory()
    if (json) {
      out(history, true)
    } else {
      if (history.length === 0) { log('  No scan history.'); return }
      for (const entry of history) {
        log(`  [${entry.timestamp}] ${entry.type} — ${entry.totalItemsCleaned} items cleaned, ${formatBytes(entry.totalSpaceSaved)} saved`)
      }
    }
  } else if (sub === 'clear') {
    clearHistory()
    out(json ? { message: 'History cleared' } : 'Scan history cleared.', json)
  } else {
    log('Usage: dustforge --cli history <list|clear>')
  }
}

async function handleRestorePoint(args: string[], json: boolean): Promise<void> {
  const { createRestorePoint } = await import('./services/restore-point')
  const description = args.slice(1).filter(a => !a.startsWith('--')).join(' ') || 'DustForge CLI restore point'

  if (args[0] === 'create') {
    if (!json) log(`Creating restore point: ${description}...`)
    const result = await createRestorePoint(description)
    out(result, json)
  } else {
    log('Usage: dustforge --cli restore-point create [description]')
  }
}

// ─── Legacy file cleaner (backward compatible) ───────────────

async function runLegacyScanClean(categories: string[], doClean: boolean, json: boolean): Promise<void> {
  const scannerMap: Record<string, () => Promise<ScanResult[]>> = {
    system: scanSystem,
    browser: scanBrowserCli,
    app: scanApp,
    gaming: scanGaming,
    'recycle-bin': scanRecycleBin,
  }

  const allResults: ScanResult[] = []

  if (!json) {
    log(`DustForge CLI v${app.getVersion()}`)
    log(`Scanning: ${categories.join(', ')}`)
    log('')
  }

  for (const cat of categories) {
    const scanner = scannerMap[cat]
    if (!scanner) continue
    if (!json) log(`Scanning ${cat}...`)
    try {
      const results = await scanner()
      allResults.push(...results)
      if (!json) {
        if (results.length === 0) log('  No items found.')
        else for (const r of results) log(`  ${r.subcategory}: ${r.itemCount} items, ${formatBytes(r.totalSize)}`)
        log('')
      }
    } catch (err: any) {
      if (!json) { log(`  Error scanning ${cat}: ${err.message}`); log('') }
    }
  }

  const totalItems = allResults.reduce((s, r) => s + r.itemCount, 0)
  const totalSize = allResults.reduce((s, r) => s + r.totalSize, 0)

  let cleanResult: CleanResult | null = null
  if (doClean && totalItems > 0) {
    if (!json) log(`Cleaning ${totalItems} items (${formatBytes(totalSize)})...`)
    const fileItemIds = allResults.filter(r => r.category !== CleanerType.RecycleBin).flatMap(r => r.items.map(i => i.id))
    const hasRecycleBin = allResults.some(r => r.category === CleanerType.RecycleBin)
    let fileCleaned: CleanResult = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    let recycleCleaned: CleanResult = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    if (fileItemIds.length > 0) fileCleaned = await cleanItems(fileItemIds)
    if (hasRecycleBin) {
      const rbSize = allResults.find(r => r.category === CleanerType.RecycleBin)?.totalSize || 0
      recycleCleaned = await cleanRecycleBin(rbSize)
    }
    cleanResult = {
      totalCleaned: fileCleaned.totalCleaned + recycleCleaned.totalCleaned,
      filesDeleted: fileCleaned.filesDeleted + recycleCleaned.filesDeleted,
      filesSkipped: fileCleaned.filesSkipped + recycleCleaned.filesSkipped,
      errors: [...fileCleaned.errors, ...recycleCleaned.errors],
      needsElevation: fileCleaned.needsElevation || recycleCleaned.needsElevation,
    }
    if (!json) {
      log(`  Deleted: ${cleanResult.filesDeleted} items (${formatBytes(cleanResult.totalCleaned)})`)
      if (cleanResult.filesSkipped > 0) log(`  Skipped: ${cleanResult.filesSkipped} items`)
      if (cleanResult.errors.length > 0) {
        log(`  Errors: ${cleanResult.errors.length}`)
        for (const err of cleanResult.errors.slice(0, 10)) log(`    ${err.path}: ${err.reason}`)
        if (cleanResult.errors.length > 10) log(`    ... and ${cleanResult.errors.length - 10} more`)
      }
      log('')
    }
  }

  if (json) {
    const output: Record<string, unknown> = {
      scan: {
        categories,
        results: allResults.map(r => ({
          category: r.category, subcategory: r.subcategory, group: r.group || null,
          itemCount: r.itemCount, totalSize: r.totalSize,
          items: r.items.map(i => ({ path: i.path, size: i.size, lastModified: i.lastModified })),
        })),
        totalItems, totalSize,
      },
    }
    if (cleanResult) output.clean = cleanResult
    log(JSON.stringify(output, null, 2))
  } else {
    log('─'.repeat(50))
    log(`Total: ${totalItems} items, ${formatBytes(totalSize)}`)
    if (cleanResult) log(`Cleaned: ${formatBytes(cleanResult.totalCleaned)}`)
    else if (totalItems > 0) log('Run with --clean to delete these items.')
  }

  app.exit(cleanResult?.errors.length ? 1 : 0)
}

// ─── Main CLI entry point ────────────────────────────────────

export async function runCli(): Promise<void> {
  const cliIndex = process.argv.indexOf('--cli')
  const cliArgs = process.argv.slice(cliIndex + 1)

  const json = cliArgs.includes('--json')
  const help = cliArgs.includes('--help') || cliArgs.includes('-h')
  const version = cliArgs.includes('--version') || cliArgs.includes('-v')

  if (help) { printHelp(); app.exit(0); return }
  if (version) { log(`DustForge v${app.getVersion()}`); app.exit(0); return }

  // Get the subcommand (first non-flag argument)
  const command = cliArgs.find(a => !a.startsWith('--') && !a.startsWith('-'))
  const subArgs = cliArgs.filter(a => a !== command)

  // Legacy flags: --system, --browser, etc.
  const legacyCats = ['system', 'browser', 'app', 'gaming', 'recycle-bin']
  const hasLegacyFlags = legacyCats.some(c => cliArgs.includes(`--${c}`)) || cliArgs.includes('--all')
  const hasCleanFlag = cliArgs.includes('--clean')

  // If no command or legacy scan/clean mode
  if (!command || command === 'scan' || command === 'clean' || hasLegacyFlags) {
    let categories: string[]
    if (cliArgs.includes('--all')) {
      categories = [...legacyCats]
    } else {
      categories = legacyCats.filter(c => cliArgs.includes(`--${c}`))
      if (categories.length === 0) categories = [...legacyCats]
    }
    const doClean = hasCleanFlag || command === 'clean'
    await runLegacyScanClean(categories, doClean, json)
    return
  }

  // Route to subcommand handlers
  const commandArgs = cliArgs.filter(a => a !== command && a !== '--json')
  try {
    switch (command) {
      case 'registry': await handleRegistry(commandArgs, json); break
      case 'startup': await handleStartup(commandArgs, json); break
      case 'debloat': await handleDebloat(commandArgs, json); break
      case 'disk': await handleDisk(commandArgs, json); break
      case 'network': await handleNetwork(commandArgs, json); break
      case 'malware': await handleMalware(commandArgs, json); break
      case 'privacy': await handlePrivacy(commandArgs, json); break
      case 'drivers': await handleDrivers(commandArgs, json); break
      case 'services': await handleServices(commandArgs, json); break
      case 'programs': await handlePrograms(commandArgs, json); break
      case 'updates': await handleUpdates(commandArgs, json); break
      case 'perf': await handlePerf(commandArgs, json); break
      case 'leftovers': await handleLeftovers(commandArgs, json); break
      case 'history': await handleHistory(commandArgs, json); break
      case 'restore-point': await handleRestorePoint(commandArgs, json); break
      default:
        log(`Unknown command: ${command}`)
        log('Run dustforge --cli --help for usage information.')
        app.exit(1)
        return
    }
    app.exit(0)
  } catch (err: any) {
    if (json) {
      log(JSON.stringify({ error: err.message }))
    } else {
      log(`Error: ${err.message}`)
    }
    app.exit(1)
  }
}
