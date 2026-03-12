import { execFileSync } from 'child_process'
import type { PlatformElevation } from '../types'

let _isAdmin: boolean | null = null

export function createWin32Elevation(): PlatformElevation {
  return {
    isAdmin(): boolean {
      if (_isAdmin !== null) return _isAdmin

      try {
        execFileSync('net', ['session'], { stdio: 'ignore', timeout: 5000 })
        _isAdmin = true
      } catch {
        _isAdmin = false
      }

      return _isAdmin
    },
  }
}
