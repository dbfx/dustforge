import type { PlatformProvider } from './types'
import { createWin32Provider } from './win32'
import { createDarwinProvider } from './darwin'
import { createLinuxProvider } from './linux'

let _provider: PlatformProvider | null = null

/**
 * Returns the platform provider for the current OS.
 * Lazy-initialized singleton — safe to call repeatedly.
 */
export function getPlatform(): PlatformProvider {
  if (_provider) return _provider

  switch (process.platform) {
    case 'win32':
      _provider = createWin32Provider()
      break
    case 'darwin':
      _provider = createDarwinProvider()
      break
    case 'linux':
      _provider = createLinuxProvider()
      break
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }

  return _provider!
}

// Re-export types for convenience
export type { PlatformProvider } from './types'
