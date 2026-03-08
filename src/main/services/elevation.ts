import { execFileSync } from 'child_process'

let _isAdmin: boolean | null = null

export function isAdmin(): boolean {
  if (_isAdmin !== null) return _isAdmin

  try {
    execFileSync('net', ['session'], { stdio: 'ignore', timeout: 5000 })
    _isAdmin = true
  } catch {
    _isAdmin = false
  }

  return _isAdmin
}
