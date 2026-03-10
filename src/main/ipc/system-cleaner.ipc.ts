import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { SYSTEM_PATHS } from '../constants/paths'
import { scanDirectory, scanFile, cleanItems } from '../services/file-utils'
import { cacheItems } from '../services/scan-cache'
import { isAdmin } from '../services/elevation'
import type { ScanResult, CleanResult } from '../../shared/types'
import { CleanerType } from '../../shared/enums'
import type { WindowGetter } from './index'

export function registerSystemCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.SYSTEM_SCAN, async (): Promise<ScanResult[]> => {
    const results: ScanResult[] = []
    const category = CleanerType.System

    const elevated = isAdmin()

    const targets: { path: string; subcategory: string; needsAdmin?: boolean }[] = [
      // Core temp files
      { path: SYSTEM_PATHS.userTemp, subcategory: 'User Temp Files' },
      { path: SYSTEM_PATHS.systemTemp, subcategory: 'System Temp Files' },
      { path: SYSTEM_PATHS.prefetch, subcategory: 'Prefetch Data', needsAdmin: true },
      { path: SYSTEM_PATHS.windowsLogs, subcategory: 'Windows Logs', needsAdmin: true },
      { path: SYSTEM_PATHS.setupLogs, subcategory: 'Setup Logs', needsAdmin: true },

      // Caches
      { path: SYSTEM_PATHS.thumbnailCache, subcategory: 'Thumbnail & Icon Cache' },
      { path: SYSTEM_PATHS.fontCache, subcategory: 'Font Cache', needsAdmin: true },
      { path: SYSTEM_PATHS.dxShaderCache, subcategory: 'DirectX Shader Cache' },
      { path: SYSTEM_PATHS.inetCache, subcategory: 'Internet Cache' },
      { path: SYSTEM_PATHS.searchIndex, subcategory: 'Windows Search Index Data', needsAdmin: true },

      // Windows Update & Delivery
      { path: SYSTEM_PATHS.windowsUpdateCache, subcategory: 'Windows Update Cache', needsAdmin: true },
      { path: SYSTEM_PATHS.deliveryOptimization, subcategory: 'Delivery Optimization Cache', needsAdmin: true },

      // Error reports & crash dumps
      { path: SYSTEM_PATHS.errorReports, subcategory: 'Error Reports' },
      { path: SYSTEM_PATHS.systemErrorReports, subcategory: 'System Error Reports', needsAdmin: true },
      { path: SYSTEM_PATHS.crashDumps, subcategory: 'Crash Dumps' },
      { path: SYSTEM_PATHS.memoryDumps, subcategory: 'Minidump Files', needsAdmin: true },

      // Windows Installer & Patches
      { path: SYSTEM_PATHS.installerPatchCache, subcategory: 'Installer Patch Cache', needsAdmin: true },

      // Event logs
      { path: SYSTEM_PATHS.eventLogs, subcategory: 'Event Log Archives', needsAdmin: true },

      // Defender scan history
      { path: SYSTEM_PATHS.defenderScanHistory, subcategory: 'Defender Scan History', needsAdmin: true },

      // Old Windows installation
      { path: SYSTEM_PATHS.windowsOld, subcategory: 'Previous Windows Installation', needsAdmin: true },
    ]

    // Skip admin-only targets when not elevated so we can report them
    const skippedForElevation: string[] = []

    // Event log files that must never be cleaned (boot trace, security audit, core OS logs, diagnostics)
    const protectedEventLogs = [
      'microsoft-windows-diagnostics-performance%4operational.evtx',
      'security.evtx',
      'system.evtx',
      'application.evtx',
      'setup.evtx',
      'microsoft-windows-windows defender%4operational.evtx',
      'microsoft-windows-powershell%4operational.evtx',
      'microsoft-windows-sysmon%4operational.evtx',
      'microsoft-windows-taskscheduler%4operational.evtx',
      'microsoft-windows-wmi-activity%4operational.evtx',
      'microsoft-windows-bits-client%4operational.evtx',
      'microsoft-windows-ntlm%4operational.evtx',
      'microsoft-windows-dns-client%4operational.evtx',
      'microsoft-windows-groupPolicy%4operational.evtx',
      'microsoft-windows-codeintegrity%4operational.evtx',
      'microsoft-windows-appLocker%4exe and dll.evtx',
    ]

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]

      if (target.needsAdmin && !elevated) {
        skippedForElevation.push(target.subcategory)
        continue
      }

      try {
        const result = await scanDirectory(target.path, category, target.subcategory)

        // Exclude protected event logs so boot trace data survives cleaning
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

        const win = getWindow()
        if (win && !win.isDestroyed()) win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category,
          currentPath: target.path,
          progress: ((i + 1) / targets.length) * 100,
          itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
          sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
        })
      } catch {
        // Skip inaccessible targets
      }
    }

    // Scan single-file targets (e.g. full memory dump)
    try {
      const dumpResult = await scanFile(SYSTEM_PATHS.fullMemoryDump, category, 'Full Memory Dump')
      if (dumpResult.items.length > 0) {
        cacheItems(dumpResult.items)
        results.push(dumpResult)
      }
    } catch {
      // Skip if not present
    }

    // If any targets were skipped due to missing elevation, add a marker result
    // so the renderer can inform the user
    if (skippedForElevation.length > 0) {
      results.push({
        category,
        subcategory: '__elevation_required',
        items: [],
        totalSize: 0,
        itemCount: 0,
        group: skippedForElevation.join(', '),
      })
    }

    return results
  })

  ipcMain.handle(IPC.SYSTEM_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    return cleanItems(itemIds)
  })
}
