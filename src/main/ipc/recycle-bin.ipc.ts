import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/channels'
import { CleanerType } from '../../shared/enums'
import type { ScanResult, CleanResult } from '../../shared/types'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

// Track last scanned size so we can report it after cleaning
let lastScannedSize = 0

export function registerRecycleBinIpc(): void {
  ipcMain.handle(IPC.RECYCLE_BIN_SCAN, async (): Promise<ScanResult[]> => {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`
      ])

      const [countStr, sizeStr] = stdout.trim().split('|')
      const count = parseInt(countStr) || 0
      const size = parseInt(sizeStr) || 0

      lastScannedSize = size

      if (count === 0) return []

      return [{
        category: CleanerType.RecycleBin,
        subcategory: 'Recycle Bin',
        items: [{
          id: randomUUID(),
          path: 'Recycle Bin',
          size,
          category: CleanerType.RecycleBin,
          subcategory: 'Recycle Bin',
          lastModified: Date.now(),
          selected: true
        }],
        totalSize: size,
        itemCount: count
      }]
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.RECYCLE_BIN_CLEAN, async (): Promise<CleanResult> => {
    const sizeBeforeClean = lastScannedSize
    try {
      // Use Shell COM API to empty recycle bin - more reliable than Clear-RecycleBin
      // which can silently fail in non-elevated or non-interactive contexts
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$shell = New-Object -ComObject Shell.Application; $shell.NameSpace(0x0a).Items() | ForEach-Object { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }; Clear-RecycleBin -Force -Confirm:$false -ErrorAction SilentlyContinue`
      ])

      // Verify the bin is actually empty
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); Write-Output $items.Count`
      ])
      const remaining = parseInt(stdout.trim()) || 0

      if (remaining === 0) {
        lastScannedSize = 0
        return { totalCleaned: sizeBeforeClean, filesDeleted: 1, filesSkipped: 0, errors: [] }
      } else {
        // Partial clean - some items couldn't be removed
        lastScannedSize = 0
        return {
          totalCleaned: sizeBeforeClean,
          filesDeleted: 1,
          filesSkipped: remaining,
          errors: [{ path: 'Recycle Bin', reason: `${remaining} item(s) could not be removed (may be in use or protected)` }]
        }
      }
    } catch (err: any) {
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [{ path: 'Recycle Bin', reason: err.message }] }
    }
  })
}
