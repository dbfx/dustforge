import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { APP_PATHS } from '../constants/paths'
import { scanMultipleDirectories, cleanItems } from '../services/file-utils'
import { cacheItems } from '../services/scan-cache'
import { CleanerType } from '../../shared/enums'
import type { ScanResult, CleanResult } from '../../shared/types'

export function registerAppCleanerIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.APP_SCAN, async (): Promise<ScanResult[]> => {
    const results: ScanResult[] = []
    const category = CleanerType.App

    for (const app of APP_PATHS) {
      try {
        const result = await scanMultipleDirectories(app.paths, category, app.name)
        if (result.items.length > 0) {
          cacheItems(result.items)
          results.push(result)
        }
      } catch {
        // Skip
      }
    }

    mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
      phase: 'scanning',
      category,
      currentPath: 'App scan complete',
      progress: 100,
      itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
      sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
    })

    return results
  })

  ipcMain.handle(IPC.APP_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    return cleanItems(itemIds)
  })
}
