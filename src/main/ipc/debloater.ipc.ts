import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/channels'
import type { BloatwareApp } from '../../shared/types'
import { randomUUID } from 'crypto'
import type { WindowGetter } from './index'

const execFileAsync = promisify(execFile)

// Known bloatware packages with metadata
export const KNOWN_BLOATWARE: Omit<BloatwareApp, 'id' | 'size' | 'selected'>[] = [
  // Microsoft apps
  { name: '3D Viewer', packageName: 'Microsoft.Microsoft3DViewer', publisher: 'Microsoft', category: 'microsoft', description: '3D model viewer — rarely used by most users' },
  { name: 'Bing News', packageName: 'Microsoft.BingNews', publisher: 'Microsoft', category: 'microsoft', description: 'News aggregator with ads' },
  { name: 'Bing Weather', packageName: 'Microsoft.BingWeather', publisher: 'Microsoft', category: 'microsoft', description: 'Weather app with ads' },
  { name: 'Clipchamp', packageName: 'Clipchamp.Clipchamp', publisher: 'Microsoft', category: 'microsoft', description: 'Video editor — promotes paid subscription' },
  { name: 'Cortana', packageName: 'Microsoft.549981C3F5F10', publisher: 'Microsoft', category: 'microsoft', description: 'Voice assistant — uses background resources' },
  { name: 'Feedback Hub', packageName: 'Microsoft.WindowsFeedbackHub', publisher: 'Microsoft', category: 'microsoft', description: 'Feedback submission tool for Windows Insiders' },
  { name: 'Get Help', packageName: 'Microsoft.GetHelp', publisher: 'Microsoft', category: 'microsoft', description: 'Windows help app — links to online support' },
  { name: 'Mail and Calendar', packageName: 'microsoft.windowscommunicationsapps', publisher: 'Microsoft', category: 'communication', description: 'Built-in mail/calendar — most users prefer Outlook or webmail' },
  { name: 'Maps', packageName: 'Microsoft.WindowsMaps', publisher: 'Microsoft', category: 'microsoft', description: 'Windows Maps — most users prefer Google Maps in browser' },
  { name: 'Microsoft News', packageName: 'Microsoft.News', publisher: 'Microsoft', category: 'microsoft', description: 'News feed with ads and tracking' },
  { name: 'Microsoft Solitaire', packageName: 'Microsoft.MicrosoftSolitaireCollection', publisher: 'Microsoft', category: 'gaming', description: 'Solitaire with ads and Xbox integration' },
  { name: 'Microsoft Tips', packageName: 'Microsoft.Getstarted', publisher: 'Microsoft', category: 'microsoft', description: 'Tips app — promotional content for Microsoft services' },
  { name: 'Microsoft To Do', packageName: 'Microsoft.Todos', publisher: 'Microsoft', category: 'microsoft', description: 'Task management — redundant if using other tools' },
  { name: 'Mixed Reality Portal', packageName: 'Microsoft.MixedReality.Portal', publisher: 'Microsoft', category: 'microsoft', description: 'VR/AR portal — unnecessary without VR headset' },
  { name: 'Movies & TV', packageName: 'Microsoft.ZuneVideo', publisher: 'Microsoft', category: 'media', description: 'Video player — most users prefer VLC or MPC' },
  { name: 'Office Hub', packageName: 'Microsoft.MicrosoftOfficeHub', publisher: 'Microsoft', category: 'microsoft', description: 'Office promotion hub — not the actual Office suite' },
  { name: 'OneNote for Windows', packageName: 'Microsoft.Office.OneNote', publisher: 'Microsoft', category: 'microsoft', description: 'OneNote UWP app — desktop version is separate' },
  { name: 'Outlook (new)', packageName: 'Microsoft.OutlookForWindows', publisher: 'Microsoft', category: 'communication', description: 'New Outlook app — replaces Mail, uses web version' },
  { name: 'Paint', packageName: 'Microsoft.MSPaint', publisher: 'Microsoft', category: 'microsoft', description: 'Windows Paint app — remove only if you use a different image editor' },
  { name: 'People', packageName: 'Microsoft.People', publisher: 'Microsoft', category: 'communication', description: 'Contact aggregator — syncs with Microsoft account' },
  { name: 'Phone Link', packageName: 'Microsoft.YourPhone', publisher: 'Microsoft', category: 'communication', description: 'Phone-to-PC app — runs background services' },
  { name: 'Power Automate', packageName: 'Microsoft.PowerAutomateDesktop', publisher: 'Microsoft', category: 'microsoft', description: 'Desktop automation tool — enterprise feature' },
  { name: 'Quick Assist', packageName: 'MicrosoftCorporationII.QuickAssist', publisher: 'Microsoft', category: 'microsoft', description: 'Remote assistance tool' },
  { name: 'Skype', packageName: 'Microsoft.SkypeApp', publisher: 'Microsoft', category: 'communication', description: 'Skype UWP — most users prefer Teams or Discord' },
  { name: 'Sticky Notes', packageName: 'Microsoft.MicrosoftStickyNotes', publisher: 'Microsoft', category: 'utility', description: 'Sticky notes — syncs with Microsoft account' },
  { name: 'Teams (personal)', packageName: 'MSTeams', publisher: 'Microsoft', category: 'communication', description: 'Teams personal edition — auto-starts and runs in background' },
  { name: 'Voice Recorder', packageName: 'Microsoft.WindowsSoundRecorder', publisher: 'Microsoft', category: 'media', description: 'Simple voice recorder' },
  { name: 'Widgets', packageName: 'MicrosoftWindows.Client.WebExperience', publisher: 'Microsoft', category: 'microsoft', description: 'Taskbar widgets — uses Edge WebView and background resources' },
  { name: 'Xbox App', packageName: 'Microsoft.XboxApp', publisher: 'Microsoft', category: 'gaming', description: 'Xbox companion app' },
  { name: 'Xbox Game Bar', packageName: 'Microsoft.XboxGamingOverlay', publisher: 'Microsoft', category: 'gaming', description: 'Game overlay — adds input latency' },
  { name: 'Xbox Speech to Text', packageName: 'Microsoft.XboxSpeechToTextOverlay', publisher: 'Microsoft', category: 'gaming', description: 'Xbox accessibility overlay' },
  { name: 'Groove Music', packageName: 'Microsoft.ZuneMusic', publisher: 'Microsoft', category: 'media', description: 'Music player — deprecated, replaced by Media Player' },
  { name: 'Bing Search', packageName: 'Microsoft.BingSearch', publisher: 'Microsoft', category: 'microsoft', description: 'Bing search integration — web searches from taskbar' },
  { name: 'Xbox (Gaming App)', packageName: 'Microsoft.GamingApp', publisher: 'Microsoft', category: 'gaming', description: 'Xbox PC app for game library and social features' },
  { name: 'Edge Game Assist', packageName: 'Microsoft.Edge.GameAssist', publisher: 'Microsoft', category: 'gaming', description: 'Edge game overlay assistant' },

  // OEM bloatware
  { name: 'Dell SupportAssist', packageName: 'DellInc.DellSupportAssistforPCs', publisher: 'Dell', category: 'oem', description: 'Dell support tool — heavy on resources and notifications' },
  { name: 'Dell Digital Delivery', packageName: 'DellInc.DellDigitalDelivery', publisher: 'Dell', category: 'oem', description: 'Dell software delivery service' },
  { name: 'Dell Command Update', packageName: 'DellInc.DellCommandUpdate', publisher: 'Dell', category: 'oem', description: 'Dell driver/BIOS updater' },
  { name: 'HP Smart', packageName: 'AD2F1837.HPPrinterControl', publisher: 'HP', category: 'oem', description: 'HP printer management — unnecessary without HP printer' },
  { name: 'HP Wolf Security', packageName: 'AD2F1837.HPWolfSecurity', publisher: 'HP', category: 'oem', description: 'HP security suite — redundant with Windows Defender' },
  { name: 'Lenovo Vantage', packageName: 'E046963F.LenovoCompanion', publisher: 'Lenovo', category: 'oem', description: 'Lenovo system management — heavy background services' },
  { name: 'Lenovo Now', packageName: 'E0469640.LenovoUtility', publisher: 'Lenovo', category: 'oem', description: 'Lenovo utility tool' },
  { name: 'McAfee', packageName: 'McAfee', publisher: 'McAfee', category: 'oem', description: 'Pre-installed antivirus — redundant with Windows Defender' },
  { name: 'Norton', packageName: 'Norton', publisher: 'NortonLifeLock', category: 'oem', description: 'Pre-installed antivirus — redundant with Windows Defender' },
  { name: 'WildTangent Games', packageName: 'WildTangentGames', publisher: 'WildTangent', category: 'oem', description: 'Pre-installed game platform — adware-like behavior' },

  // Common pre-installed apps
  { name: 'Disney+', packageName: 'Disney.37853FC22B2CE', publisher: 'Disney', category: 'media', description: 'Streaming app — pre-installed promotion' },
  { name: 'Spotify', packageName: 'SpotifyAB.SpotifyMusic', publisher: 'Spotify', category: 'media', description: 'Music streaming — pre-installed promotion' },
  { name: 'TikTok', packageName: 'BytedancePte.Ltd.TikTok', publisher: 'ByteDance', category: 'media', description: 'Social media — pre-installed promotion' },
  { name: 'Instagram', packageName: 'Facebook.InstagramBeta', publisher: 'Meta', category: 'communication', description: 'Social media — pre-installed promotion' },
  { name: 'Facebook', packageName: 'Facebook.Facebook', publisher: 'Meta', category: 'communication', description: 'Social media — pre-installed promotion' },
  { name: 'Candy Crush Saga', packageName: 'king.com.CandyCrushSaga', publisher: 'King', category: 'gaming', description: 'Pre-installed game with microtransactions' },
  { name: 'Candy Crush Friends', packageName: 'king.com.CandyCrushFriends', publisher: 'King', category: 'gaming', description: 'Pre-installed game with microtransactions' },
  { name: 'Bubble Witch 3', packageName: 'king.com.BubbleWitch3Saga', publisher: 'King', category: 'gaming', description: 'Pre-installed game with microtransactions' },
  { name: 'March of Empires', packageName: 'Gameloft.MarchofEmpires', publisher: 'Gameloft', category: 'gaming', description: 'Pre-installed game with microtransactions' },
]

// ── Exported core logic ──

export async function scanBloatware(): Promise<BloatwareApp[]> {
  const apps: BloatwareApp[] = []

  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-AppxPackage | ForEach-Object {
        $size = 0
        if ($_.InstallLocation -and (Test-Path $_.InstallLocation)) {
          $size = (Get-ChildItem -Path $_.InstallLocation -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
          if (-not $size) { $size = 0 }
        }
        [PSCustomObject]@{ Name = $_.Name; PackageFullName = $_.PackageFullName; InstallLocation = $_.InstallLocation; Size = $size }
      } | ConvertTo-Json -Compress`
    ], { timeout: 60000 })

    let installedPackages: { Name: string; PackageFullName: string; InstallLocation: string; Size: number }[] = []
    try {
      const parsed = JSON.parse(stdout)
      installedPackages = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return apps
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      const matchedPkg = installedPackages.find(p =>
        p.Name === bloatware.packageName ||
        p.Name.startsWith(bloatware.packageName + '.')
      )

      if (matchedPkg) {
        let sizeStr = 'Unknown'
        const bytes = matchedPkg.Size || 0
        if (bytes > 0) {
          if (bytes > 1024 * 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
          else if (bytes > 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          else if (bytes > 1024) sizeStr = `${(bytes / 1024).toFixed(0)} KB`
          else sizeStr = `${bytes} B`
        }

        apps.push({
          id: randomUUID(),
          name: bloatware.name,
          packageName: matchedPkg.Name,
          publisher: bloatware.publisher,
          category: bloatware.category,
          description: bloatware.description,
          size: sizeStr,
          selected: false
        })
      }
    }
  } catch {
    // PowerShell not available or failed
  }

  return apps
}

export async function removeBloatware(
  packageNames: string[],
  onProgress?: (current: number, total: number, currentApp: string, status: 'removing' | 'done' | 'failed') => void
): Promise<{ removed: number; failed: number }> {
  const knownNames = new Set(KNOWN_BLOATWARE.map(b => b.packageName))
  const validNames = packageNames.filter(name =>
    typeof name === 'string' && knownNames.has(name)
  )

  let removed = 0
  let failed = 0

  for (let i = 0; i < validNames.length; i++) {
    const pkgName = validNames[i]
    const safeName = pkgName.replace(/'/g, "''")
    onProgress?.(i + 1, validNames.length, pkgName, 'removing')
    try {
      await execFileAsync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-AppxPackage '${safeName}' | Remove-AppxPackage -ErrorAction Stop`
      ], { timeout: 30000 })
      removed++
      onProgress?.(i + 1, validNames.length, pkgName, 'done')

      try {
        await execFileAsync('powershell', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq '${safeName}' } | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue`
        ], { timeout: 15000 })
      } catch {
        // Deprovisioning failed (needs admin) — not critical
      }
    } catch {
      failed++
      onProgress?.(i + 1, validNames.length, pkgName, 'failed')
    }
  }

  return { removed, failed }
}

// ── IPC registration ──

export function registerDebloaterIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DEBLOATER_SCAN, () => {
    if (process.platform !== 'win32') return []
    return scanBloatware()
  })

  ipcMain.handle(IPC.DEBLOATER_REMOVE, async (_event, packageNames: string[]): Promise<{ removed: number; failed: number }> => {
    if (process.platform !== 'win32') return { removed: 0, failed: 0 }
    return removeBloatware(packageNames, (current, total, currentApp, status) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.DEBLOATER_REMOVE_PROGRESS, { current, total, currentApp, status })
    })
  })
}
