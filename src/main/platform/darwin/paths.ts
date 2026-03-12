import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { PlatformPaths, CleanTarget, BrowserPathConfig, AppCacheDef, UninstallLeftoverDir } from '../types'

const HOME = homedir()
const LIBRARY = join(HOME, 'Library')
const CACHES = join(LIBRARY, 'Caches')
const APP_SUPPORT = join(LIBRARY, 'Application Support')

export function createDarwinPaths(): PlatformPaths {
  return {
    systemCleanTargets(): CleanTarget[] {
      return [
        { path: tmpdir(), subcategory: 'User Temp Files' },
        { path: '/private/tmp', subcategory: 'System Temp Files' },
        { path: join(LIBRARY, 'Logs'), subcategory: 'User Logs' },
        { path: '/Library/Logs', subcategory: 'System Logs', needsAdmin: true },
        { path: join(LIBRARY, 'Logs', 'DiagnosticReports'), subcategory: 'Crash Reports' },
        { path: join(CACHES, 'com.apple.QuickLook.thumbnailcache'), subcategory: 'Thumbnail Cache' },
        { path: '/Library/Caches/com.apple.ATS', subcategory: 'Font Cache', needsAdmin: true },
      ]
    },

    singleFileCleanTargets(): string[] {
      // macOS doesn't have a single memory dump file like Windows
      return []
    },

    protectedEventLogs(): string[] {
      // Not applicable on macOS
      return []
    },

    browserPaths(): BrowserPathConfig {
      return {
        chrome: {
          base: join(APP_SUPPORT, 'Google', 'Chrome'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        edge: {
          base: join(APP_SUPPORT, 'Microsoft Edge'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        brave: {
          base: join(APP_SUPPORT, 'BraveSoftware', 'Brave-Browser'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        opera: {
          base: join(APP_SUPPORT, 'com.operasoftware.Opera'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        operaGX: {
          base: join(APP_SUPPORT, 'com.operasoftware.OperaGX'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        vivaldi: {
          base: join(APP_SUPPORT, 'Vivaldi'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        firefox: {
          base: join(APP_SUPPORT, 'Firefox', 'Profiles'),
          cache: join(CACHES, 'Firefox', 'Profiles'),
        },
      }
    },

    appPaths(): AppCacheDef[] {
      return [
        { id: 'discord', name: 'Discord', paths: [join(APP_SUPPORT, 'discord', 'Cache', 'Cache_Data')] },
        { id: 'vscode', name: 'VS Code', paths: [join(APP_SUPPORT, 'Code', 'Cache', 'Cache_Data'), join(APP_SUPPORT, 'Code', 'CachedData')] },
        { id: 'slack', name: 'Slack', paths: [join(APP_SUPPORT, 'Slack', 'Cache', 'Cache_Data')] },
        { id: 'teams', name: 'Microsoft Teams', paths: [join(APP_SUPPORT, 'Microsoft Teams', 'Cache')] },
        { id: 'spotify', name: 'Spotify', paths: [join(CACHES, 'com.spotify.client')] },
        { id: 'npm', name: 'npm Cache', paths: [join(HOME, '.npm', '_cacache')] },
        { id: 'yarn', name: 'Yarn Cache', paths: [join(CACHES, 'Yarn')] },
        { id: 'pip', name: 'pip Cache', paths: [join(CACHES, 'pip')] },
        { id: 'homebrew', name: 'Homebrew Cache', paths: [join(CACHES, 'Homebrew')] },
      ]
    },

    gamingPaths(): AppCacheDef[] {
      return [
        { id: 'steam', name: 'Steam', paths: [join(APP_SUPPORT, 'Steam', 'logs')] },
      ]
    },

    gpuCachePaths(): AppCacheDef[] {
      return [
        { id: 'metal-cache', name: 'Metal Shader Cache', paths: [join(CACHES, 'com.apple.metal')] },
      ]
    },

    malwareScanDirs(): string[] {
      return [
        join(HOME, 'Downloads'),
        join(HOME, 'Desktop'),
        join(HOME, 'Documents'),
        '/tmp',
        // Target specific ~/Library subdirs rather than the entire ~/Library
        // (which contains thousands of legitimate files and would be extremely slow)
        join(LIBRARY, 'LaunchAgents'),
        join(HOME, '.local', 'bin'),
      ]
    },

    malwareSystemDirs(): string[] {
      return [
        '/System',
        '/usr',
        '/Library',
        '/Applications',
      ]
    },

    uninstallLeftoverDirs(): UninstallLeftoverDir[] {
      return [
        { id: 'app-support', name: 'Application Support', path: APP_SUPPORT },
        { id: 'caches', name: 'Caches', path: CACHES },
        { id: 'preferences', name: 'Preferences', path: join(LIBRARY, 'Preferences') },
      ]
    },

    steamLibraries(): string[] {
      return [join(APP_SUPPORT, 'Steam', 'steamapps')]
    },

    steamRedistPatterns(): string[] {
      // Same patterns apply cross-platform
      return [
        '_CommonRedist', 'DirectX', 'dotNetFx', 'vcredist',
        'DXSETUP', 'UE4PrereqSetup', 'Redist',
      ]
    },

    trashPath(): string | null {
      return join(HOME, '.Trash')
    },
  }
}
