import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { scanForLeftovers } from '../services/uninstall-leftovers'
import { cleanItems } from '../services/file-utils'
import { cacheItems } from '../services/scan-cache'
import type { ScanResult, CleanResult } from '../../shared/types'

export function registerUninstallLeftoversIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.UNINSTALL_LEFTOVERS_SCAN, async (): Promise<ScanResult[]> => {
    const results = await scanForLeftovers(mainWindow)

    // Cache all items so the clean handler can look them up by ID
    for (const result of results) {
      cacheItems(result.items)
    }

    return results
  })

  ipcMain.handle(IPC.UNINSTALL_LEFTOVERS_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    return cleanItems(itemIds)
  })
}
