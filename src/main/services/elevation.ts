import { getPlatform } from '../platform'

export function isAdmin(): boolean {
  return getPlatform().elevation.isAdmin()
}
