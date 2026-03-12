import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { PlatformPaths, CleanTarget, BrowserPathConfig, AppCacheDef, UninstallLeftoverDir } from '../types'

const HOME = homedir()
const CONFIG = join(HOME, '.config')
const CACHE = join(HOME, '.cache')
const LOCAL_SHARE = join(HOME, '.local', 'share')

export function createLinuxPaths(): PlatformPaths {
  return {
    systemCleanTargets(): CleanTarget[] {
      return [
        { path: tmpdir(), subcategory: 'User Temp Files' },
        { path: '/tmp', subcategory: 'System Temp Files' },
        { path: '/var/tmp', subcategory: 'Persistent Temp Files' },
        { path: join(CACHE, 'thumbnails'), subcategory: 'Thumbnail Cache' },
        { path: '/var/crash', subcategory: 'Crash Reports', needsAdmin: true },
      ]
    },

    singleFileCleanTargets(): string[] {
      return []
    },

    protectedEventLogs(): string[] {
      return []
    },

    browserPaths(): BrowserPathConfig {
      return {
        chrome: {
          base: join(CONFIG, 'google-chrome'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        edge: {
          base: join(CONFIG, 'microsoft-edge'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        brave: {
          base: join(CONFIG, 'BraveSoftware', 'Brave-Browser'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        opera: {
          base: join(CONFIG, 'opera'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        operaGX: {
          // Opera GX is not available on Linux
          base: join(CONFIG, 'opera-gx'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        vivaldi: {
          base: join(CONFIG, 'vivaldi'),
          cache: 'Cache',
          codeCache: 'Code Cache',
          gpuCache: 'GpuCache',
          serviceWorker: join('Service Worker', 'CacheStorage'),
        },
        firefox: {
          base: join(HOME, '.mozilla', 'firefox'),
          cache: join(CACHE, 'mozilla', 'firefox'),
        },
      }
    },

    appPaths(): AppCacheDef[] {
      return [
        { id: 'discord', name: 'Discord', paths: [join(CONFIG, 'discord', 'Cache', 'Cache_Data')] },
        { id: 'vscode', name: 'VS Code', paths: [join(CONFIG, 'Code', 'Cache', 'Cache_Data'), join(CONFIG, 'Code', 'CachedData')] },
        { id: 'slack', name: 'Slack', paths: [join(CONFIG, 'Slack', 'Cache', 'Cache_Data')] },
        { id: 'teams', name: 'Microsoft Teams', paths: [join(CONFIG, 'Microsoft', 'Microsoft Teams', 'Cache')] },
        { id: 'spotify', name: 'Spotify', paths: [join(CACHE, 'spotify')] },
        { id: 'npm', name: 'npm Cache', paths: [join(HOME, '.npm', '_cacache')] },
        { id: 'yarn', name: 'Yarn Cache', paths: [join(CACHE, 'yarn')] },
        { id: 'pip', name: 'pip Cache', paths: [join(CACHE, 'pip')] },
      ]
    },

    gamingPaths(): AppCacheDef[] {
      return [
        { id: 'steam', name: 'Steam', paths: [
          join(HOME, '.steam', 'steam', 'logs'),
          join(LOCAL_SHARE, 'Steam', 'logs'),
        ]},
      ]
    },

    gpuCachePaths(): AppCacheDef[] {
      return [
        { id: 'mesa-cache', name: 'Mesa Shader Cache', paths: [join(CACHE, 'mesa_shader_cache')] },
        { id: 'nvidia-cache', name: 'NVIDIA Shader Cache', paths: [join(CACHE, 'nvidia', 'GLCache')] },
      ]
    },

    malwareScanDirs(): string[] {
      return [
        join(HOME, 'Downloads'),
        join(HOME, 'Desktop'),
        join(HOME, 'Documents'),
        '/tmp',
      ]
    },

    malwareSystemDirs(): string[] {
      return ['/usr', '/lib', '/lib64', '/sbin', '/bin', '/opt']
    },

    uninstallLeftoverDirs(): UninstallLeftoverDir[] {
      return [
        { id: 'config', name: 'Config', path: CONFIG },
        { id: 'cache', name: 'Cache', path: CACHE },
        { id: 'local-share', name: 'Data', path: LOCAL_SHARE },
      ]
    },

    steamLibraries(): string[] {
      return [
        join(HOME, '.steam', 'steam', 'steamapps'),
        join(LOCAL_SHARE, 'Steam', 'steamapps'),
      ]
    },

    steamRedistPatterns(): string[] {
      return [
        '_CommonRedist', 'DirectX', 'dotNetFx', 'vcredist',
        'DXSETUP', 'UE4PrereqSetup', 'Redist',
      ]
    },

    trashPath(): string | null {
      return join(LOCAL_SHARE, 'Trash', 'files')
    },
  }
}
