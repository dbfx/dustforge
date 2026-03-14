import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { IPC } from '../../shared/channels'
import { registerSystemCleanerIpc } from './system-cleaner.ipc'
import { registerBrowserCleanerIpc } from './browser-cleaner.ipc'
import { registerAppCleanerIpc } from './app-cleaner.ipc'
import { registerGamingCleanerIpc } from './gaming-cleaner.ipc'
import { registerRecycleBinIpc } from './recycle-bin.ipc'
import { registerRegistryCleanerIpc } from './registry-cleaner.ipc'
import { registerStartupManagerIpc } from './startup-manager.ipc'
import { registerDebloaterIpc } from './debloater.ipc'
import { registerDiskAnalyzerIpc } from './disk-analyzer.ipc'
import { registerNetworkCleanupIpc } from './network-cleanup.ipc'
import { registerMalwareScannerIpc } from './malware-scanner.ipc'
import { registerPrivacyShieldIpc } from './privacy-shield.ipc'
import { registerUninstallLeftoversIpc } from './uninstall-leftovers.ipc'
import { registerDriverManagerIpc } from './driver-manager.ipc'
import { registerPerfMonitorIpc } from './perf-monitor.ipc'
import { registerProgramUninstallerIpc } from './program-uninstaller.ipc'
import { registerServiceManagerIpc } from './service-manager.ipc'
import { registerSoftwareUpdaterIpc } from './software-updater.ipc'
import { registerCloudAgentIpc } from './cloud-agent.ipc'
import { getSettings, setSettings, getOnboardingComplete, setOnboardingComplete } from '../services/settings-store'
import { isAdmin } from '../services/elevation'
import { getHistory, addHistoryEntry, clearHistory } from '../services/history-store'
import { getCloudHistory, clearCloudHistory } from '../services/cloud-history-store'
import { validateSettingsPartial, validateHistoryEntry } from '../services/ipc-validation'
import { createRestorePoint } from '../services/restore-point'
import { checkForUpdates, downloadUpdate, installUpdate, getUpdateStatus, setAutoDownload } from '../services/auto-updater'

export type WindowGetter = () => BrowserWindow | null

export function registerCleanerIpc(getWindow: WindowGetter): void {
  registerSystemCleanerIpc(getWindow)
  registerBrowserCleanerIpc(getWindow)
  registerAppCleanerIpc(getWindow)
  registerGamingCleanerIpc(getWindow)
  registerRecycleBinIpc()
  registerRegistryCleanerIpc(getWindow)
  registerStartupManagerIpc()
  registerDebloaterIpc(getWindow)
  registerDiskAnalyzerIpc(getWindow)
  registerNetworkCleanupIpc()
  registerMalwareScannerIpc(getWindow)
  registerUninstallLeftoversIpc(getWindow)
  registerPrivacyShieldIpc(getWindow)
  registerDriverManagerIpc(getWindow)
  registerPerfMonitorIpc()
  registerProgramUninstallerIpc(getWindow)
  registerServiceManagerIpc(getWindow)
  registerSoftwareUpdaterIpc(getWindow)
  registerCloudAgentIpc()

  // Settings — validate shape before persisting
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, (_event, settings) => {
    const validated = validateSettingsPartial(settings)
    if (!validated) return { success: false, error: 'Invalid settings' }
    setSettings(validated)
    if (typeof validated.autoUpdate === 'boolean') {
      setAutoDownload(validated.autoUpdate)
    }
    return { success: true }
  })

  // Onboarding
  ipcMain.handle(IPC.ONBOARDING_GET, () => getOnboardingComplete())
  ipcMain.handle(IPC.ONBOARDING_SET, (_event, value: boolean) => {
    if (typeof value !== 'boolean') return
    setOnboardingComplete(value)
  })

  // Elevation
  ipcMain.handle(IPC.ELEVATION_CHECK, () => isAdmin())
  ipcMain.handle(IPC.ELEVATION_RELAUNCH, () => {
    const exePath = app.getPath('exe')
    // Use -EncodedCommand to avoid any string interpolation / quoting issues
    const psScript = `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' -Verb RunAs`
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
    spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
    app.quit()
  })

  // System Restore Point
  ipcMain.handle(IPC.RESTORE_POINT_CREATE, (_event, description: string) => {
    if (typeof description !== 'string') description = ''
    // Sanitize: restrict to safe characters and cap length
    const sanitized = (description || 'DustForge pre-clean restore point')
      .replace(/[^A-Za-z0-9 ._\-()]/g, '')
      .slice(0, 200)
    return createRestorePoint(sanitized)
  })

  // Scan history — validate entry shape before persisting
  ipcMain.handle(IPC.HISTORY_GET, () => getHistory())
  ipcMain.handle(IPC.HISTORY_ADD, (_event, entry) => {
    const validated = validateHistoryEntry(entry)
    if (validated) addHistoryEntry(validated)
  })
  ipcMain.handle(IPC.HISTORY_CLEAR, () => clearHistory())

  // Cloud action history
  ipcMain.handle(IPC.CLOUD_HISTORY_GET, () => getCloudHistory())
  ipcMain.handle(IPC.CLOUD_HISTORY_CLEAR, () => clearCloudHistory())

  // Auto-updater
  ipcMain.handle(IPC.UPDATER_CHECK, () => checkForUpdates())
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, () => downloadUpdate())
  ipcMain.handle(IPC.UPDATER_INSTALL, () => { installUpdate() })
  ipcMain.handle(IPC.UPDATER_GET_STATUS, () => getUpdateStatus())
}
