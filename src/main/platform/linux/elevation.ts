import type { PlatformElevation } from '../types'

export function createLinuxElevation(): PlatformElevation {
  return {
    isAdmin(): boolean {
      return process.getuid?.() === 0
    },
  }
}
