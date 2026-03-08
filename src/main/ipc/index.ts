import { BrowserWindow, ipcMain } from 'electron'
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
import { getSettings, setSettings, getOnboardingComplete, setOnboardingComplete } from '../services/settings-store'
import { isAdmin } from '../services/elevation'
import { getHistory, addHistoryEntry, clearHistory } from '../services/history-store'
import { validateSettingsPartial } from '../services/ipc-validation'

export function registerCleanerIpc(mainWindow: BrowserWindow): void {
  registerSystemCleanerIpc(mainWindow)
  registerBrowserCleanerIpc(mainWindow)
  registerAppCleanerIpc(mainWindow)
  registerGamingCleanerIpc(mainWindow)
  registerRecycleBinIpc(mainWindow)
  registerRegistryCleanerIpc(mainWindow)
  registerStartupManagerIpc(mainWindow)
  registerDebloaterIpc(mainWindow)
  registerDiskAnalyzerIpc(mainWindow)
  registerNetworkCleanupIpc(mainWindow)
  registerMalwareScannerIpc(mainWindow)
  registerUninstallLeftoversIpc(mainWindow)
  registerPrivacyShieldIpc(mainWindow)

  // Settings — validate shape before persisting
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, (_event, settings) => {
    const validated = validateSettingsPartial(settings)
    if (validated) setSettings(validated)
  })

  // Onboarding
  ipcMain.handle(IPC.ONBOARDING_GET, () => getOnboardingComplete())
  ipcMain.handle(IPC.ONBOARDING_SET, (_event, value: boolean) => setOnboardingComplete(value))

  // Elevation
  ipcMain.handle(IPC.ELEVATION_CHECK, () => isAdmin())

  // Scan history
  ipcMain.handle(IPC.HISTORY_GET, () => getHistory())
  ipcMain.handle(IPC.HISTORY_ADD, (_event, entry) => addHistoryEntry(entry))
  ipcMain.handle(IPC.HISTORY_CLEAR, () => clearHistory())
}
