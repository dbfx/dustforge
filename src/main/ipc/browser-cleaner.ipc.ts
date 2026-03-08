import { BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import { BROWSER_PATHS } from '../constants/paths'
import { scanDirectory, cleanItems } from '../services/file-utils'
import { cacheItems } from '../services/scan-cache'
import { getSettings } from '../services/settings-store'
import { CleanerType } from '../../shared/enums'
import type { ScanResult, CleanResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

/** Kill browser processes before cleaning cache files */
async function closeBrowsers(): Promise<void> {
  const browserProcesses = [
    'chrome.exe', 'msedge.exe', 'brave.exe', 'vivaldi.exe',
    'opera.exe', 'firefox.exe'
  ]
  for (const proc of browserProcesses) {
    try {
      await execFileAsync('taskkill', ['/IM', proc, '/F'], { timeout: 5000 })
    } catch {
      // Process not running, ignore
    }
  }
}

interface ChromiumBrowserDef {
  key: string
  label: string
  base: string
  cache: string
  codeCache: string
  gpuCache: string
  serviceWorker: string
  hasProfiles: boolean
}

const chromiumBrowsers: ChromiumBrowserDef[] = [
  { key: 'chrome', label: 'Chrome', ...BROWSER_PATHS.chrome, hasProfiles: true },
  { key: 'edge', label: 'Edge', ...BROWSER_PATHS.edge, hasProfiles: true },
  { key: 'brave', label: 'Brave', ...BROWSER_PATHS.brave, hasProfiles: true },
  { key: 'vivaldi', label: 'Vivaldi', ...BROWSER_PATHS.vivaldi, hasProfiles: true },
  // Opera stores profiles differently — cache is directly under the base path
  { key: 'opera', label: 'Opera', ...BROWSER_PATHS.opera, hasProfiles: false },
  { key: 'operaGX', label: 'Opera GX', ...BROWSER_PATHS.operaGX, hasProfiles: false },
]

export function registerBrowserCleanerIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.BROWSER_SCAN, async (): Promise<ScanResult[]> => {
    const results: ScanResult[] = []
    const category = CleanerType.Browser

    // Scan all Chromium-based browsers
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
        // Opera-style: cache dirs directly under base
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

    mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
      phase: 'scanning',
      category,
      currentPath: 'Browser scan complete',
      progress: 100,
      itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
      sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
    })

    return results
  })

  ipcMain.handle(IPC.BROWSER_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    const settings = getSettings()
    if (settings.cleaner.closeBrowsersBeforeClean) {
      await closeBrowsers()
    }
    return cleanItems(itemIds)
  })
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
