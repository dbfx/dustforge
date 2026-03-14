import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/channels'
import { registerCleanerIpc } from './ipc'
import { getSettings } from './services/settings-store'
import { startScheduler, stopScheduler, getNextScanTime, notifyScheduledScanComplete } from './services/scheduler'
import { initAutoUpdater } from './services/auto-updater'
import { cloudAgent } from './services/cloud-agent'
import { runCli } from './cli'
import { runDaemon } from './daemon'

// ─── Headless mode flags ─────────────────────────────────────
// When running without a GUI (daemon or CLI), disable GPU and sandbox
// so Electron works on headless Linux servers without X11/Wayland.
if (process.argv.includes('--daemon') || process.argv.includes('--cli')) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('ozone-platform', 'headless')
}

// ─── Linux root detection ────────────────────────────────────
// Chromium refuses to run as root without --no-sandbox.  This is hit when
// the user relaunches via pkexec or runs with sudo for privileged ops.
if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
  app.commandLine.appendSwitch('no-sandbox')
}

// ─── CLI / Daemon mode ───────────────────────────────────────
// If --cli is passed, run headless and exit — no GUI, no tray.
// If --daemon is passed, run headless cloud agent and stay alive.
if (process.argv.includes('--cli')) {
  app.whenReady().then(() => runCli())
} else if (process.argv.includes('--daemon')) {
  app.whenReady().then(() => runDaemon())
} else {
  initGui()
}

function initGui(): void {

// Prevent multiple instances — if another is already running, focus it and quit this one
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  return
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let ipcRegistered = false

function getIconPath(): string {
  const ext = process.platform === 'darwin' ? 'icns' : process.platform === 'linux' ? 'png' : 'ico'
  return app.isPackaged
    ? join(process.resourcesPath, `icon.${ext}`)
    : join(__dirname, `../../resources/icon.${ext}`)
}

function applyAutoLaunch(enabled: boolean): void {
  // Only register auto-launch when packaged — in dev mode this would register
  // the bare Electron binary, causing a generic "Getting Started" window on reboot.
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--startup']
  })
}

function createTray(): void {
  if (tray) return

  const icon = nativeImage.createFromPath(getIconPath())
  // Resize for tray (16x16 on most platforms)
  const trayIcon = icon.resize({ width: 16, height: 16 })

  tray = new Tray(trayIcon)
  tray.setToolTip('DustForge')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open DustForge',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        // Force quit — don't intercept close
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.removeAllListeners('close')
        }
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
}

function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.round(screenWidth * 0.75)
  const height = Math.round(screenHeight * 0.8)

  const icon = nativeImage.createFromPath(getIconPath())

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#09090b',
    icon,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const settings = getSettings()
  const isStartupLaunch = process.argv.includes('--startup')

  mainWindow.on('ready-to-show', () => {
    // If launched at startup with minimize-to-tray, stay hidden
    if (isStartupLaunch && settings.minimizeToTray) {
      // Don't show — just sit in tray
    } else {
      mainWindow?.show()
    }
  })

  // Intercept close to minimize to tray if enabled
  mainWindow.on('close', (e) => {
    const currentSettings = getSettings()
    if (currentSettings.minimizeToTray && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only allow opening HTTPS URLs externally
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })

  // Register IPC handlers only once to avoid stacking on window recreation
  if (!ipcRegistered) {
    // Window control IPC — use current mainWindow reference
    ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize())
    ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow?.maximize()
      }
    })
    ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close())

    // Register all IPC handlers (pass getter so handlers always use current window)
    registerCleanerIpc(() => mainWindow)

    ipcRegistered = true
  }

  // Load the app
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  const settings = getSettings()

  // Apply auto-launch setting
  applyAutoLaunch(settings.runAtStartup)

  // Create tray if minimize-to-tray is enabled or scheduled scans are on
  if (settings.minimizeToTray || settings.schedule.enabled) {
    createTray()
  }

  createWindow()

  // Initialize auto-updater
  initAutoUpdater()

  // Start the scheduled scan checker
  startScheduler(() => mainWindow)

  // Start cloud agent if linked
  if (settings.cloud.apiKey) {
    cloudAgent.start()
  }

  // Listen for settings changes to update auto-launch and tray
  ipcMain.on(IPC.SETTINGS_APPLY_STARTUP, (_event, enabled: boolean) => {
    applyAutoLaunch(enabled)
  })

  ipcMain.on(IPC.SETTINGS_APPLY_TRAY, (_event, enabled: boolean) => {
    if (enabled) {
      createTray()
    } else if (!getSettings().schedule.enabled) {
      destroyTray()
    }
  })

  // IPC to get next scan time for the UI
  ipcMain.handle(IPC.SCHEDULE_NEXT_SCAN, () => {
    const s = getSettings()
    const next = getNextScanTime(s)
    return next ? next.toISOString() : null
  })

  // Handle scheduled scan completion notification from renderer
  ipcMain.on(IPC.SCHEDULE_SCAN_COMPLETE, (_event, totalSize: number, itemCount: number) => {
    notifyScheduledScanComplete(totalSize, itemCount)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  const settings = getSettings()
  // Don't quit if minimize-to-tray or scheduled scans are enabled
  if (settings.minimizeToTray || settings.schedule.enabled) {
    // Stay alive in tray
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopScheduler()
  cloudAgent.stop()
})

} // end initGui
