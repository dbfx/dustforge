import { join } from 'path'
import { homedir } from 'os'
import type { PlatformPaths, CleanTarget, BrowserPathConfig, AppCacheDef, UninstallLeftoverDir } from '../types'

const HOME = homedir()
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local')
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming')
const WINDIR = process.env.WINDIR || 'C:\\Windows'
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData'
const PROGRAMFILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const PROGRAMFILES = process.env.ProgramFiles || 'C:\\Program Files'

// Only cache paths — never touch cookies, history, sessions, passwords, or bookmarks
const CHROMIUM_CACHE_DIRS = {
  cache: 'Cache\\Cache_Data',
  codeCache: 'Code Cache',
  gpuCache: 'GPUCache',
  serviceWorker: 'Service Worker\\CacheStorage',
}

export function createWin32Paths(): PlatformPaths {
  return {
    systemCleanTargets(): CleanTarget[] {
      return [
        { path: join(LOCALAPPDATA, 'Temp'), subcategory: 'User Temp Files' },
        { path: join(WINDIR, 'Temp'), subcategory: 'System Temp Files' },
        { path: join(WINDIR, 'Prefetch'), subcategory: 'Prefetch Data', needsAdmin: true },
        { path: join(WINDIR, 'Logs'), subcategory: 'Windows Logs', needsAdmin: true },
        { path: join(WINDIR, 'Panther'), subcategory: 'Setup Logs', needsAdmin: true },
        { path: join(LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer'), subcategory: 'Thumbnail & Icon Cache' },
        { path: join(WINDIR, 'ServiceProfiles', 'LocalService', 'AppData', 'Local', 'FontCache'), subcategory: 'Font Cache', needsAdmin: true },
        { path: join(LOCALAPPDATA, 'D3DSCache'), subcategory: 'DirectX Shader Cache' },
        { path: join(LOCALAPPDATA, 'Microsoft', 'Windows', 'INetCache'), subcategory: 'Internet Cache' },
        { path: join(WINDIR, 'SoftwareDistribution', 'Download'), subcategory: 'Windows Update Cache', needsAdmin: true },
        { path: join(WINDIR, 'SoftwareDistribution', 'DeliveryOptimization'), subcategory: 'Delivery Optimization Cache', needsAdmin: true },
        { path: join(LOCALAPPDATA, 'Microsoft', 'Windows', 'WER'), subcategory: 'Error Reports' },
        { path: join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER'), subcategory: 'System Error Reports', needsAdmin: true },
        { path: join(LOCALAPPDATA, 'CrashDumps'), subcategory: 'Crash Dumps' },
        { path: join(WINDIR, 'Minidump'), subcategory: 'Minidump Files', needsAdmin: true },
        { path: join(WINDIR, 'Installer', '$PatchCache$'), subcategory: 'Installer Patch Cache', needsAdmin: true },
        { path: join(WINDIR, 'System32', 'winevt', 'Logs'), subcategory: 'Event Log Archives', needsAdmin: true },
        { path: join(PROGRAMDATA, 'Microsoft', 'Windows Defender', 'Scans', 'History'), subcategory: 'Defender Scan History', needsAdmin: true },
        { path: 'C:\\Windows.old', subcategory: 'Previous Windows Installation', needsAdmin: true },
      ]
    },

    singleFileCleanTargets(): string[] {
      return [join(WINDIR, 'MEMORY.DMP')]
    },

    protectedEventLogs(): string[] {
      return [
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
    },

    browserPaths(): BrowserPathConfig {
      return {
        chrome: { base: join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data'), ...CHROMIUM_CACHE_DIRS },
        edge: { base: join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data'), ...CHROMIUM_CACHE_DIRS },
        brave: { base: join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data'), ...CHROMIUM_CACHE_DIRS },
        opera: { base: join(APPDATA, 'Opera Software', 'Opera Stable'), ...CHROMIUM_CACHE_DIRS },
        operaGX: { base: join(APPDATA, 'Opera Software', 'Opera GX Stable'), ...CHROMIUM_CACHE_DIRS },
        vivaldi: { base: join(LOCALAPPDATA, 'Vivaldi', 'User Data'), ...CHROMIUM_CACHE_DIRS },
        firefox: {
          base: join(APPDATA, 'Mozilla', 'Firefox', 'Profiles'),
          cache: join(LOCALAPPDATA, 'Mozilla', 'Firefox', 'Profiles'),
        },
      }
    },

    appPaths(): AppCacheDef[] {
      return [
        { id: 'discord', name: 'Discord', paths: [join(APPDATA, 'discord', 'Cache', 'Cache_Data'), join(APPDATA, 'discord', 'Code Cache'), join(APPDATA, 'discord', 'GPUCache')] },
        { id: 'teams', name: 'Microsoft Teams', paths: [join(APPDATA, 'Microsoft', 'Teams', 'Cache')] },
        { id: 'slack', name: 'Slack', paths: [join(APPDATA, 'Slack', 'Cache', 'Cache_Data'), join(APPDATA, 'Slack', 'Code Cache'), join(APPDATA, 'Slack', 'GPUCache')] },
        { id: 'zoom', name: 'Zoom', paths: [join(APPDATA, 'Zoom', 'data'), join(APPDATA, 'Zoom', 'logs')] },
        { id: 'telegram', name: 'Telegram', paths: [join(APPDATA, 'Telegram Desktop', 'tdata', 'user_data'), join(APPDATA, 'Telegram Desktop', 'tdata', 'emoji')] },
        { id: 'vscode', name: 'VS Code', paths: [join(APPDATA, 'Code', 'Cache', 'Cache_Data'), join(APPDATA, 'Code', 'CachedData'), join(APPDATA, 'Code', 'CachedExtensions'), join(APPDATA, 'Code', 'logs')] },
        { id: 'jetbrains', name: 'JetBrains IDEs', paths: [join(LOCALAPPDATA, 'JetBrains')] },
        { id: 'spotify', name: 'Spotify', paths: [join(LOCALAPPDATA, 'Spotify', 'Storage'), join(LOCALAPPDATA, 'Spotify', 'Data')] },
        { id: 'obs', name: 'OBS Studio', paths: [join(APPDATA, 'obs-studio', 'logs'), join(APPDATA, 'obs-studio', 'profiler_data')] },
        { id: 'adobe', name: 'Adobe Creative Cloud', paths: [join(LOCALAPPDATA, 'Adobe', 'AcroCef', 'Cache'), join(APPDATA, 'Adobe', 'Common', 'Media Cache Files'), join(APPDATA, 'Adobe', 'Common', 'Media Cache')] },
        { id: 'npm', name: 'npm Cache', paths: [join(APPDATA, 'npm-cache')] },
        { id: 'yarn', name: 'Yarn Cache', paths: [join(LOCALAPPDATA, 'Yarn', 'Cache')] },
        { id: 'pnpm', name: 'pnpm Store', paths: [join(LOCALAPPDATA, 'pnpm-store')] },
        { id: 'bun', name: 'Bun Cache', paths: [join(LOCALAPPDATA, '.bun', 'install', 'cache')] },
        { id: 'pip', name: 'pip Cache', paths: [join(LOCALAPPDATA, 'pip', 'Cache')] },
        { id: 'nuget', name: 'NuGet Cache', paths: [join(LOCALAPPDATA, 'NuGet', 'v3-cache'), join(LOCALAPPDATA, 'NuGet', 'plugins-cache')] },
        { id: 'cargo', name: 'Cargo/Rust Cache', paths: [join(HOME, '.cargo', 'registry', 'cache'), join(HOME, '.cargo', 'registry', 'src')] },
        { id: 'go', name: 'Go Module Cache', paths: [join(HOME, 'go', 'pkg', 'mod', 'cache')] },
        { id: 'gradle', name: 'Gradle Cache', paths: [join(HOME, '.gradle', 'caches'), join(HOME, '.gradle', 'daemon')] },
        { id: 'maven', name: 'Maven Cache', paths: [join(HOME, '.m2', 'repository')] },
        { id: 'composer', name: 'Composer Cache', paths: [join(LOCALAPPDATA, 'Composer', 'cache')] },
        { id: 'docker', name: 'Docker Desktop', paths: [join(LOCALAPPDATA, 'Docker', 'wsl', 'data'), join(APPDATA, 'Docker Desktop', 'cache')] },
      ]
    },

    gamingPaths(): AppCacheDef[] {
      return [
        { id: 'steam', name: 'Steam Launcher', paths: [join(PROGRAMFILES_X86, 'Steam', 'logs'), join(PROGRAMFILES_X86, 'Steam', 'dumps'), join(PROGRAMFILES_X86, 'Steam', 'appcache', 'httpcache')] },
        { id: 'epic', name: 'Epic Games Launcher', paths: [join(LOCALAPPDATA, 'EpicGamesLauncher', 'Saved', 'webcache'), join(LOCALAPPDATA, 'EpicGamesLauncher', 'Saved', 'webcache_4430'), join(LOCALAPPDATA, 'EpicGamesLauncher', 'Saved', 'Logs'), join(LOCALAPPDATA, 'EpicGamesLauncher', 'Intermediate'), join(PROGRAMDATA, 'Epic', 'EpicGamesLauncher', 'VaultCache')] },
        { id: 'ea', name: 'EA App', paths: [join(LOCALAPPDATA, 'Electronic Arts', 'EA Desktop', 'Logs'), join(LOCALAPPDATA, 'Electronic Arts', 'EA Desktop', 'IGOCache'), join(LOCALAPPDATA, 'EADesktop', 'cache'), join(LOCALAPPDATA, 'Origin', 'cache')] },
        { id: 'ubisoft', name: 'Ubisoft Connect', paths: [join(LOCALAPPDATA, 'Ubisoft Game Launcher', 'logs')] },
        { id: 'gog', name: 'GOG Galaxy', paths: [join(LOCALAPPDATA, 'GOG.com', 'Galaxy', 'webcache'), join(PROGRAMDATA, 'GOG.com', 'Galaxy', 'logs'), join(PROGRAMDATA, 'GOG.com', 'Galaxy', 'webcache')] },
        { id: 'battlenet', name: 'Battle.net', paths: [join(LOCALAPPDATA, 'Blizzard Entertainment', 'Battle.net', 'Logs'), join(APPDATA, 'Battle.net', 'Logs')] },
        { id: 'riot', name: 'Riot Games', paths: [join(LOCALAPPDATA, 'Riot Games', 'Riot Client', 'Logs')] },
        { id: 'xbox', name: 'Xbox App', paths: [join(LOCALAPPDATA, 'Packages', 'Microsoft.GamingApp_8wekyb3d8bbwe', 'LocalCache'), join(LOCALAPPDATA, 'Packages', 'Microsoft.XboxApp_8wekyb3d8bbwe', 'LocalCache')] },
      ]
    },

    gpuCachePaths(): AppCacheDef[] {
      return [
        { id: 'nvidia', name: 'NVIDIA Shader Cache', paths: [join(LOCALAPPDATA, 'NVIDIA', 'GLCache'), join(LOCALAPPDATA, 'NVIDIA', 'DXCache'), join(LOCALAPPDATA, 'NVIDIA Corporation', 'NV_Cache'), join(PROGRAMDATA, 'NVIDIA Corporation', 'NV_Cache')] },
        { id: 'amd', name: 'AMD Shader Cache', paths: [join(LOCALAPPDATA, 'AMD', 'DxCache'), join(LOCALAPPDATA, 'AMD', 'GLCache'), join(LOCALAPPDATA, 'AMD', 'VkCache')] },
      ]
    },

    malwareScanDirs(): string[] {
      const userProfile = process.env.USERPROFILE || HOME
      return [
        join(userProfile, 'Downloads'),
        join(userProfile, 'Desktop'),
        join(userProfile, 'Documents'),
        join(LOCALAPPDATA, 'Temp'),
        APPDATA,
        LOCALAPPDATA,
        PROGRAMDATA,
      ]
    },

    malwareSystemDirs(): string[] {
      return [
        'c:\\windows\\system32',
        'c:\\windows\\syswow64',
        'c:\\windows',
        'c:\\windows\\servicing',
        'c:\\windows\\winsxs',
      ]
    },

    uninstallLeftoverDirs(): UninstallLeftoverDir[] {
      return [
        { id: 'localappdata', name: 'AppData Local', path: LOCALAPPDATA },
        { id: 'appdata', name: 'AppData Roaming', path: APPDATA },
        { id: 'programfiles', name: 'Program Files', path: PROGRAMFILES },
        { id: 'programfiles-x86', name: 'Program Files (x86)', path: PROGRAMFILES_X86 },
        { id: 'programdata', name: 'ProgramData', path: PROGRAMDATA },
      ]
    },

    steamLibraries(): string[] {
      return [
        join(PROGRAMFILES_X86, 'Steam'),
        join(PROGRAMFILES, 'Steam'),
        'D:\\SteamLibrary',
        'E:\\SteamLibrary',
        'F:\\SteamLibrary',
      ]
    },

    steamRedistPatterns(): string[] {
      return [
        '_CommonRedist', 'CommonRedist', '__installer', '__Installer',
        '_Redist', 'Redist', 'redist', 'DirectX', 'directx',
        'vcredist', 'VCRedist', 'DotNetFX', 'dotnetfx',
        'UE4PrereqSetup', 'xnafx', 'DXSETUP', 'Mono',
        'WindowsNoEditor\\Engine\\Extras\\Redist',
      ]
    },

    trashPath(): string | null {
      // Windows recycle bin is managed via COM/PowerShell, not a simple folder
      return null
    },
  }
}
