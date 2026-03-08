import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../../shared/channels'
import { getSettings } from './settings-store'
import type { UpdateStatus } from '../../shared/types'

let status: UpdateStatus = { state: 'idle' }

function broadcast(s: UpdateStatus): void {
  status = s
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.UPDATER_STATUS, s)
    }
  }
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  const settings = getSettings()
  autoUpdater.autoDownload = settings.autoUpdate
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (prog) => {
    broadcast({ state: 'downloading', progress: Math.round(prog.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    broadcast({ state: 'error', error: err?.message || 'Update failed' })
  })

  // Check on startup
  autoUpdater.checkForUpdates().catch(() => {})
}

export function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  return autoUpdater.checkForUpdates().then(() => {})
}

export function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  return autoUpdater.downloadUpdate().then(() => {})
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall(false, true)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function setAutoDownload(enabled: boolean): void {
  if (app.isPackaged) {
    autoUpdater.autoDownload = enabled
  }
}
