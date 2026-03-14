import { describe, it, expect, vi } from 'vitest'

vi.mock('../platform', () => ({ getPlatform: () => ({}) }))
vi.mock('../constants/uninstall-safelist', () => ({
  SAFE_FOLDER_NAMES: new Set(['windows', 'program files', 'system32', 'microsoft']),
  SAFE_PREFIXES: ['microsoft.', 'windows.'],
}))
vi.mock('./file-utils', () => ({ getDirectorySize: () => 0 }))

import {
  parseRegValue,
  parseRegDword,
  extractRegistryKey,
  splitArgs,
  parseUninstallCommand,
  isSafeFolder,
  folderMatchesProgram,
} from './program-uninstaller'
import type { InstalledProgram } from '../../shared/types'

function makeProgram(overrides: Partial<InstalledProgram> = {}): InstalledProgram {
  return {
    id: 'test',
    displayName: 'Test App',
    publisher: 'Test Publisher',
    displayVersion: '1.0.0',
    installDate: '',
    estimatedSize: 0,
    installLocation: '',
    uninstallString: '',
    quietUninstallString: '',
    displayIcon: '',
    registryKey: '',
    isSystemComponent: false,
    isWindowsInstaller: false,
    lastUsed: -1,
    ...overrides,
  }
}

// ─── parseRegValue ──────────────────────────────────────────

describe('parseRegValue', () => {
  it('extracts a REG_SZ value', () => {
    const block = '    DisplayName    REG_SZ    Google Chrome\r\n    Publisher    REG_SZ    Google LLC'
    expect(parseRegValue(block, 'DisplayName')).toBe('Google Chrome')
    expect(parseRegValue(block, 'Publisher')).toBe('Google LLC')
  })

  it('returns empty for missing key', () => {
    expect(parseRegValue('DisplayName    REG_SZ    Chrome', 'Publisher')).toBe('')
  })

  it('does not match substrings (UninstallString vs QuietUninstallString)', () => {
    const block = '    QuietUninstallString    REG_SZ    "C:\\quiet.exe"\r\n    UninstallString    REG_SZ    "C:\\uninstall.exe"'
    expect(parseRegValue(block, 'UninstallString')).toBe('"C:\\uninstall.exe"')
  })
})

// ─── parseRegDword ──────────────────────────────────────────

describe('parseRegDword', () => {
  it('extracts a DWORD value', () => {
    const block = '    SystemComponent    REG_DWORD    0x1'
    expect(parseRegDword(block, 'SystemComponent')).toBe(1)
  })

  it('returns 0 for missing key', () => {
    expect(parseRegDword('nothing here', 'SystemComponent')).toBe(0)
  })

  it('handles large hex values', () => {
    const block = '    EstimatedSize    REG_DWORD    0x1A2B3'
    expect(parseRegDword(block, 'EstimatedSize')).toBe(0x1A2B3)
  })
})

// ─── extractRegistryKey ─────────────────────────────────────

describe('extractRegistryKey', () => {
  it('extracts the registry key from a block', () => {
    const block = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Chrome\r\n    DisplayName    REG_SZ    Chrome'
    expect(extractRegistryKey(block)).toBe('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Chrome')
  })

  it('returns empty for no HK line', () => {
    expect(extractRegistryKey('no key here')).toBe('')
  })
})

// ─── splitArgs ──────────────────────────────────────────────

describe('splitArgs', () => {
  it('splits simple whitespace-separated args', () => {
    expect(splitArgs('/silent /norestart')).toEqual(['/silent', '/norestart'])
  })

  it('preserves quoted strings with spaces', () => {
    expect(splitArgs('/DIR="C:\\Program Files\\App" /silent')).toEqual([
      '/DIR="C:\\Program Files\\App"',
      '/silent',
    ])
  })

  it('handles empty string', () => {
    expect(splitArgs('')).toEqual([])
  })

  it('handles multiple spaces between args', () => {
    expect(splitArgs('a   b   c')).toEqual(['a', 'b', 'c'])
  })
})

// ─── parseUninstallCommand ──────────────────────────────────

describe('parseUninstallCommand', () => {
  it('parses MSI uninstall with GUID', () => {
    const p = makeProgram({
      isWindowsInstaller: true,
      uninstallString: 'MsiExec.exe /I{12345678-1234-1234-1234-123456789012}',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('msiexec')
    expect(result.args).toEqual(['/x', '{12345678-1234-1234-1234-123456789012}'])
  })

  it('parses quoted path uninstaller', () => {
    const p = makeProgram({
      uninstallString: '"C:\\Program Files\\App\\uninstall.exe" /silent',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\Program Files\\App\\uninstall.exe')
    expect(result.args).toEqual(['/silent'])
  })

  it('parses unquoted exe path', () => {
    const p = makeProgram({
      uninstallString: 'C:\\App\\uninstall.exe /quiet',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\App\\uninstall.exe')
    expect(result.args).toEqual(['/quiet'])
  })

  it('falls back to whole string for no exe', () => {
    const p = makeProgram({ uninstallString: 'some-custom-command' })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('some-custom-command')
    expect(result.args).toEqual([])
  })
})

// ─── isSafeFolder ───────────────────────────────────────────

describe('isSafeFolder', () => {
  it('returns true for known safe folder names', () => {
    expect(isSafeFolder('Windows')).toBe(true)
    expect(isSafeFolder('System32')).toBe(true)
  })

  it('returns true for safe prefixes', () => {
    expect(isSafeFolder('Microsoft.Edge')).toBe(true)
    expect(isSafeFolder('Windows.Security')).toBe(true)
  })

  it('returns true for dot-prefixed (hidden) folders', () => {
    expect(isSafeFolder('.config')).toBe(true)
  })

  it('returns true for GUID folders', () => {
    expect(isSafeFolder('{12345678-1234-1234-1234-123456789012}')).toBe(true)
  })

  it('returns false for a regular app folder', () => {
    expect(isSafeFolder('SomeApp')).toBe(false)
  })
})

// ─── folderMatchesProgram ───────────────────────────────────

describe('folderMatchesProgram', () => {
  it('matches folder containing program name', () => {
    const p = makeProgram({ displayName: 'Visual Studio Code' })
    expect(folderMatchesProgram('visual studio code', p)).toBe(true)
  })

  it('matches folder that is a substring of program name', () => {
    const p = makeProgram({ displayName: 'Google Chrome Browser' })
    expect(folderMatchesProgram('chrome', p)).toBe(true)
  })

  it('matches by publisher name', () => {
    const p = makeProgram({ displayName: 'Some Tool', publisher: 'JetBrains' })
    expect(folderMatchesProgram('jetbrains', p)).toBe(true)
  })

  it('matches by install location basename', () => {
    const p = makeProgram({
      displayName: 'Some App',
      installLocation: 'C:\\Program Files\\discord',
    })
    expect(folderMatchesProgram('discord', p)).toBe(true)
  })

  it('does not match unrelated folder', () => {
    const p = makeProgram({ displayName: 'Google Chrome' })
    expect(folderMatchesProgram('firefox', p)).toBe(false)
  })

  it('does not match very short tokens (< 4 chars)', () => {
    const p = makeProgram({ displayName: 'AB' })
    expect(folderMatchesProgram('xy', p)).toBe(false)
  })
})
