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

// ─── Argument parsing ────────────────────────────────────────

interface CliOptions {
  categories: string[]
  clean: boolean
  json: boolean
  help: boolean
  version: boolean
}

const VALID_CATEGORIES = ['system', 'browser', 'app', 'gaming', 'recycle-bin', 'all']

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(1) // skip '--cli' itself
  const options: CliOptions = {
    categories: [],
    clean: false,
    json: false,
    help: false,
    version: false,
  }

  for (const arg of args) {
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--version':
      case '-v':
        options.version = true
        break
      case '--clean':
        options.clean = true
        break
      case '--json':
        options.json = true
        break
      case '--all':
        options.categories = ['system', 'browser', 'app', 'gaming', 'recycle-bin']
        break
      case '--system':
      case '--browser':
      case '--app':
      case '--gaming':
      case '--recycle-bin':
        options.categories.push(arg.substring(2))
        break
      default:
        if (arg.startsWith('--')) {
          log(`Unknown option: ${arg}`)
          options.help = true
        }
    }
  }

  // Default to --all if no categories specified and not help/version
  if (options.categories.length === 0 && !options.help && !options.version) {
    options.categories = ['system', 'browser', 'app', 'gaming', 'recycle-bin']
  }

  return options
}

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

function printHelp(): void {
  log(`
DustForge CLI — Run scans from the command line

Usage:
  dustforge --cli [options] [categories...]

Categories:
  --system        System temp files, caches, logs, crash dumps
  --browser       Browser caches (Chrome, Edge, Brave, Firefox, etc.)
  --app           Application caches (Discord, VS Code, npm, etc.)
  --gaming        Game launcher caches, GPU shader caches, redistributables
  --recycle-bin   Windows Recycle Bin
  --all           All categories (default if none specified)

Options:
  --clean         Delete found items after scanning (without this, scan-only)
  --json          Output results as JSON instead of human-readable text
  -h, --help      Show this help message
  -v, --version   Show version

Examples:
  dustforge --cli                        Scan all categories (dry run)
  dustforge --cli --system --browser     Scan system and browser only
  dustforge --cli --all --clean          Scan everything and clean
  dustforge --cli --json                 Scan all, output JSON
  dustforge --cli --system --clean       Scan and clean system junk only

Exit codes:
  0   Success
  1   Error during scan or clean
`.trim())
}

// ─── Scan implementations (mirror IPC handlers) ──────────────

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
    { path: SYSTEM_PATHS.searchIndex, subcategory: 'Windows Search Index Data' },
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
    'security.evtx',
    'system.evtx',
    'application.evtx',
    'setup.evtx',
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

      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      // Skip inaccessible targets
    }
  }

  try {
    const dumpResult = await scanFile(SYSTEM_PATHS.fullMemoryDump, category, 'Full Memory Dump')
    if (dumpResult.items.length > 0) {
      cacheItems(dumpResult.items)
      results.push(dumpResult)
    }
  } catch {
    // Skip if not present
  }

  return results
}

async function scanBrowser(): Promise<ScanResult[]> {
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
        const cacheDirs = [
          { dir: browser.cache, label: 'Cache' },
          { dir: browser.codeCache, label: 'Code Cache' },
          { dir: browser.gpuCache, label: 'GPU Cache' },
          { dir: browser.serviceWorker, label: 'Service Worker Cache' },
        ]
        for (const { dir, label } of cacheDirs) {
          const cachePath = join(browser.base, profile, dir)
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `${browser.label} - ${profile} ${label}`)
            if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
          }
        }
      }
    } else {
      const cacheDirs = [
        { dir: browser.cache, label: 'Cache' },
        { dir: browser.codeCache, label: 'Code Cache' },
        { dir: browser.gpuCache, label: 'GPU Cache' },
        { dir: browser.serviceWorker, label: 'Service Worker Cache' },
      ]
      for (const { dir, label } of cacheDirs) {
        const cachePath = join(browser.base, dir)
        if (existsSync(cachePath)) {
          const result = await scanDirectory(cachePath, category, `${browser.label} - ${label}`)
          if (result.items.length > 0) { cacheItems(result.items); results.push(result) }
        }
      }
    }
  }

  // Firefox
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
    } catch {
      // Skip
    }
  }

  return results
}

async function scanApp(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.App

  for (const appDef of APP_PATHS) {
    try {
      const result = await scanMultipleDirectories(appDef.paths, category, appDef.name)
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      // Skip
    }
  }

  return results
}

async function scanGaming(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.Gaming

  for (const launcher of GAMING_PATHS) {
    try {
      const result = await scanDirectoriesAsItems(launcher.paths, category, launcher.name, 'Launcher Caches')
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      // Skip
    }
  }

  for (const gpu of GPU_CACHE_PATHS) {
    try {
      const result = await scanDirectoriesAsItems(gpu.paths, category, gpu.name, 'GPU Shader Caches')
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      // Skip
    }
  }

  return results
}

async function scanRecycleBin(): Promise<ScanResult[]> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`
    ])

    const [countStr, sizeStr] = stdout.trim().split('|')
    const count = parseInt(countStr) || 0
    const size = parseInt(sizeStr) || 0

    if (count === 0) return []

    const item = {
      id: randomUUID(),
      path: 'Recycle Bin',
      size,
      category: CleanerType.RecycleBin,
      subcategory: 'Recycle Bin',
      lastModified: Date.now(),
      selected: true,
    }
    cacheItems([item])

    return [{
      category: CleanerType.RecycleBin,
      subcategory: 'Recycle Bin',
      items: [item],
      totalSize: size,
      itemCount: count,
    }]
  } catch {
    return []
  }
}

async function cleanRecycleBin(sizeBytes: number = 0): Promise<CleanResult> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'
    ])
    return { totalCleaned: sizeBytes, filesDeleted: 1, filesSkipped: 0, errors: [] }
  } catch (err: any) {
    return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [{ path: 'Recycle Bin', reason: err.message }] }
  }
}

async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) {
        profiles.push(entry.name)
      }
    }
  } catch {
    // Skip
  }
  return profiles
}

// ─── Main CLI entry point ────────────────────────────────────

export async function runCli(): Promise<void> {
  // Find the --cli flag position and parse everything after it
  const cliIndex = process.argv.indexOf('--cli')
  const cliArgs = process.argv.slice(cliIndex)
  const options = parseArgs(cliArgs)

  if (options.help) {
    printHelp()
    app.exit(0)
    return
  }

  if (options.version) {
    log(`DustForge v${app.getVersion()}`)
    app.exit(0)
    return
  }

  const allResults: ScanResult[] = []
  const scannerMap: Record<string, () => Promise<ScanResult[]>> = {
    system: scanSystem,
    browser: scanBrowser,
    app: scanApp,
    gaming: scanGaming,
    'recycle-bin': scanRecycleBin,
  }

  if (!options.json) {
    log(`DustForge CLI v${app.getVersion()}`)
    log(`Scanning: ${options.categories.join(', ')}`)
    log('')
  }

  for (const cat of options.categories) {
    const scanner = scannerMap[cat]
    if (!scanner) continue

    if (!options.json) {
      log(`Scanning ${cat}...`)
    }

    try {
      const results = await scanner()
      allResults.push(...results)

      if (!options.json) {
        if (results.length === 0) {
          log(`  No items found.`)
        } else {
          for (const r of results) {
            log(`  ${r.subcategory}: ${r.itemCount} items, ${formatBytes(r.totalSize)}`)
          }
        }
        log('')
      }
    } catch (err: any) {
      if (!options.json) {
        log(`  Error scanning ${cat}: ${err.message}`)
        log('')
      }
    }
  }

  const totalItems = allResults.reduce((s, r) => s + r.itemCount, 0)
  const totalSize = allResults.reduce((s, r) => s + r.totalSize, 0)

  // ── Clean phase ──
  let cleanResult: CleanResult | null = null
  if (options.clean && totalItems > 0) {
    if (!options.json) {
      log(`Cleaning ${totalItems} items (${formatBytes(totalSize)})...`)
    }

    // Collect all item IDs for file-based cleaners
    const fileItemIds = allResults
      .filter(r => r.category !== CleanerType.RecycleBin)
      .flatMap(r => r.items.map(i => i.id))

    const hasRecycleBin = allResults.some(r => r.category === CleanerType.RecycleBin)

    let fileCleaned: CleanResult = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [] }
    let recycleCleaned: CleanResult = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [] }

    if (fileItemIds.length > 0) {
      fileCleaned = await cleanItems(fileItemIds)
    }
    if (hasRecycleBin) {
      const rbSize = allResults.find(r => r.category === CleanerType.RecycleBin)?.totalSize || 0
      recycleCleaned = await cleanRecycleBin(rbSize)
    }

    cleanResult = {
      totalCleaned: fileCleaned.totalCleaned + recycleCleaned.totalCleaned,
      filesDeleted: fileCleaned.filesDeleted + recycleCleaned.filesDeleted,
      filesSkipped: fileCleaned.filesSkipped + recycleCleaned.filesSkipped,
      errors: [...fileCleaned.errors, ...recycleCleaned.errors],
    }

    if (!options.json) {
      log(`  Deleted: ${cleanResult.filesDeleted} items (${formatBytes(cleanResult.totalCleaned)})`)
      if (cleanResult.filesSkipped > 0) {
        log(`  Skipped: ${cleanResult.filesSkipped} items`)
      }
      if (cleanResult.errors.length > 0) {
        log(`  Errors: ${cleanResult.errors.length}`)
        for (const err of cleanResult.errors.slice(0, 10)) {
          log(`    ${err.path}: ${err.reason}`)
        }
        if (cleanResult.errors.length > 10) {
          log(`    ... and ${cleanResult.errors.length - 10} more`)
        }
      }
      log('')
    }
  }

  // ── Summary ──
  if (options.json) {
    const output: Record<string, unknown> = {
      scan: {
        categories: options.categories,
        results: allResults.map(r => ({
          category: r.category,
          subcategory: r.subcategory,
          group: r.group || null,
          itemCount: r.itemCount,
          totalSize: r.totalSize,
          items: r.items.map(i => ({
            path: i.path,
            size: i.size,
            lastModified: i.lastModified,
          })),
        })),
        totalItems,
        totalSize,
      },
    }
    if (cleanResult) {
      output.clean = {
        totalCleaned: cleanResult.totalCleaned,
        filesDeleted: cleanResult.filesDeleted,
        filesSkipped: cleanResult.filesSkipped,
        errors: cleanResult.errors,
      }
    }
    log(JSON.stringify(output, null, 2))
  } else {
    log('─'.repeat(50))
    log(`Total: ${totalItems} items, ${formatBytes(totalSize)}`)
    if (cleanResult) {
      log(`Cleaned: ${formatBytes(cleanResult.totalCleaned)}`)
    } else if (totalItems > 0) {
      log(`Run with --clean to delete these items.`)
    }
  }

  app.exit(cleanResult?.errors.length ? 1 : 0)
}
