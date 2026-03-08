import { BrowserWindow, ipcMain } from 'electron'
import { readdir, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import type { DiskNode, DriveInfo } from '../../shared/types'

const execFileAsync = promisify(execFile)

const MAX_DEPTH = 3

export function registerDiskAnalyzerIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.DISK_DRIVES, async (): Promise<DriveInfo[]> => {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$fixed = (Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }).DeviceID -replace ':',''; Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and $fixed -contains $_.Name } | ForEach-Object { "$($_.Name)|$($_.Description)|$($_.Used)|$($_.Free)" }`
      ], { timeout: 10000 })

      const drives: DriveInfo[] = []
      for (const line of stdout.trim().split('\n')) {
        const [letter, label, used, free] = line.trim().split('|')
        if (letter && used && free) {
          const usedSpace = parseInt(used) || 0
          const freeSpace = parseInt(free) || 0
          drives.push({
            letter: letter.trim(),
            label: label?.trim() || letter.trim(),
            totalSize: usedSpace + freeSpace,
            freeSpace,
            usedSpace
          })
        }
      }
      return drives
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.DISK_ANALYZE, async (_event, driveLetter: string): Promise<DiskNode> => {
    // Validate drive letter is exactly one letter A-Z to prevent path traversal
    if (typeof driveLetter !== 'string' || !/^[A-Za-z]$/.test(driveLetter)) {
      return { name: '', path: '', size: 0, children: [] }
    }
    const rootPath = `${driveLetter.toUpperCase()}:\\`
    const root = await analyzeDirectory(rootPath, 0, mainWindow)
    return root
  })
}

async function analyzeDirectory(
  dirPath: string,
  depth: number,
  mainWindow: BrowserWindow
): Promise<DiskNode> {
  const node: DiskNode = {
    name: dirPath.split('\\').pop() || dirPath,
    path: dirPath,
    size: 0,
    children: []
  }

  if (depth >= MAX_DEPTH) {
    node.size = await quickSize(dirPath)
    return node
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const child = await analyzeDirectory(fullPath, depth + 1, mainWindow)
          node.children!.push(child)
          node.size += child.size
        } else {
          const s = await stat(fullPath)
          node.size += s.size
        }
      } catch {
        // Skip inaccessible
      }
    }

    // Send progress for top-level directories
    if (depth === 0) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk',
        currentPath: dirPath,
        progress: 50,
        itemsFound: node.children!.length,
        sizeFound: node.size
      })
    }
  } catch {
    // Inaccessible directory
  }

  // Sort children by size descending
  node.children?.sort((a, b) => b.size - a.size)

  return node
}

async function quickSize(dirPath: string): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        const s = await stat(join(dirPath, entry.name))
        size += s.isDirectory() ? 0 : s.size
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return size
}
