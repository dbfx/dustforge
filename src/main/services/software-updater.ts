import { execFile } from 'child_process'
import { promisify } from 'util'
import type {
  UpdatableApp,
  UpToDateApp,
  UpdateCheckResult,
  UpdateProgress,
  UpdateResult,
  UpdateSeverity,
} from '../../shared/types'

const execFileAsync = promisify(execFile)

function cleanOutput(str: string): string {
  // Strip ANSI escape sequences
  let cleaned = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
  // Handle \r (carriage return) used by spinners: for each line segment,
  // keep only the text after the last \r (since \r overwrites from the start).
  // Lines ending with \r\n produce a trailing empty part after split — use
  // the last non-empty part instead.
  cleaned = cleaned
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim()) return parts[i]
      }
      return ''
    })
    .join('\n')
  return cleaned
}

function computeSeverity(current: string, available: string): UpdateSeverity {
  const parse = (v: string): [number, number, number] | null => {
    const m = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
    if (!m) return null
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3] ?? '0')]
  }

  const c = parse(current)
  const a = parse(available)
  if (!c || !a) return 'unknown'

  if (a[0] > c[0]) return 'major'
  if (a[0] === c[0] && a[1] > c[1]) return 'minor'
  if (a[0] === c[0] && a[1] === c[1] && a[2] > c[2]) return 'patch'
  return 'unknown'
}

function parseWingetUpgradeOutput(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  // Find the header line
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/Name\s+Id\s+Version\s+Available\s+Source/i.test(lines[i])) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  // Separator line (dashes) is right after header
  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx])) return []

  const header = lines[headerIdx]
  const idStart = header.indexOf('Id')
  const versionStart = header.indexOf('Version')
  const availableStart = header.indexOf('Available')
  const sourceStart = header.indexOf('Source')

  if (idStart < 0 || versionStart < 0 || availableStart < 0 || sourceStart < 0) return []

  const apps: UpdatableApp[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    // Stop at summary line like "42 upgrades available."
    if (/^\d+\s+upgrade/i.test(line.trim())) break

    const name = line.substring(0, idStart).trim()
    const id = line.substring(idStart, versionStart).trim()
    let version = line.substring(versionStart, availableStart).trim()
    let available = line.substring(availableStart, sourceStart).trim()
    if (version.startsWith('> ')) version = version.slice(2)
    if (available.startsWith('> ')) available = available.slice(2)
    const source = line.substring(sourceStart).trim()

    if (!id || !version || !available) continue

    apps.push({
      id,
      name: name || id,
      currentVersion: version,
      availableVersion: available,
      source: source || 'winget',
      severity: computeSeverity(version, available),
      selected: true,
    })
  }
  return apps
}

function parseWingetListOutput(stdout: string): UpToDateApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  // Find header — winget list has: Name  Id  Version  Available  Source
  // (Available column may be empty for most apps)
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/Name\s+Id\s+Version/i.test(lines[i])) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx])) return []

  const header = lines[headerIdx]
  const idStart = header.indexOf('Id')
  const versionStart = header.indexOf('Version')
  // Available and Source columns may or may not exist in winget list
  const availableStart = header.indexOf('Available')
  const sourceStart = header.indexOf('Source')

  if (idStart < 0 || versionStart < 0) return []

  const versionEnd = availableStart > 0 ? availableStart : sourceStart > 0 ? sourceStart : -1

  const apps: UpToDateApp[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (/^\d+\s+package/i.test(line.trim())) break

    const name = line.substring(0, idStart).trim()
    const id = line.substring(idStart, versionStart).trim()
    let version = versionEnd > 0
      ? line.substring(versionStart, versionEnd).trim()
      : line.substring(versionStart).trim()
    // winget list sometimes prefixes versions with "> " — strip it
    if (version.startsWith('> ')) version = version.slice(2)
    const source = sourceStart > 0 ? line.substring(sourceStart).trim() : ''

    if (!id || !version || version === 'Unknown') continue
    // Skip ARP entries (not real winget packages)
    if (id.startsWith('ARP\\')) continue

    apps.push({ id, name: name || id, version, source: source || 'winget' })
  }
  return apps
}

async function isWingetAvailable(): Promise<boolean> {
  try {
    await execFileAsync('winget', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const available = await isWingetAvailable()
  if (!available) {
    return {
      apps: [],
      upToDate: [],
      totalCount: 0,
      majorCount: 0,
      minorCount: 0,
      patchCount: 0,
      wingetAvailable: false,
    }
  }

  try {
    let stdout = ''
    try {
      const result = await execFileAsync(
        'winget',
        ['upgrade', '--accept-source-agreements', '--disable-interactivity'],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      )
      stdout = result.stdout
    } catch (err: any) {
      // winget may exit with non-zero code even on success (e.g. 0x8A150014 = no updates)
      // but still produce valid output in stdout
      if (err?.stdout) {
        stdout = err.stdout
      } else {
        return {
          apps: [],
          upToDate: [],
          totalCount: 0,
          majorCount: 0,
          minorCount: 0,
          patchCount: 0,
          wingetAvailable: true,
        }
      }
    }

    const apps = parseWingetUpgradeOutput(stdout)

    // Also get the full list of winget-tracked apps to show "up to date" ones
    let upToDate: UpToDateApp[] = []
    try {
      let listStdout = ''
      try {
        const listResult = await execFileAsync(
          'winget',
          ['list', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'],
          { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        )
        listStdout = listResult.stdout
      } catch (err: any) {
        if (err?.stdout) listStdout = err.stdout
      }
      if (listStdout) {
        const allApps = parseWingetListOutput(listStdout)
        const outdatedIds = new Set(apps.map((a) => a.id))
        upToDate = allApps.filter((a) => !outdatedIds.has(a.id))
      }
    } catch {
      // Non-critical — just skip the up-to-date list
    }

    return {
      apps,
      upToDate,
      totalCount: apps.length,
      majorCount: apps.filter((a) => a.severity === 'major').length,
      minorCount: apps.filter((a) => a.severity === 'minor').length,
      patchCount: apps.filter((a) => a.severity === 'patch').length,
      wingetAvailable: true,
    }
  } catch {
    return {
      apps: [],
      upToDate: [],
      totalCount: 0,
      majorCount: 0,
      minorCount: 0,
      patchCount: 0,
      wingetAvailable: true,
    }
  }
}

export async function runUpdates(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  const errors: UpdateResult['errors'] = []

  for (let i = 0; i < appIds.length; i++) {
    const appId = appIds[i]
    onProgress({
      phase: 'updating',
      current: i + 1,
      total: appIds.length,
      currentApp: appId,
      percent: Math.round((i / appIds.length) * 100),
      status: 'in-progress',
    })

    try {
      let upgradeStdout = ''
      try {
        const result = await execFileAsync(
          'winget',
          [
            'upgrade',
            appId,
            '--accept-source-agreements',
            '--accept-package-agreements',
            '--disable-interactivity',
            '--include-unknown',
          ],
          { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        )
        upgradeStdout = result.stdout
      } catch (err: any) {
        // winget often exits non-zero even on success — check stdout for result
        if (err?.stdout) {
          upgradeStdout = err.stdout
        } else {
          throw err
        }
      }

      // Check if the output indicates success despite non-zero exit code
      const output = cleanOutput(upgradeStdout).toLowerCase()
      const wasSuccessful =
        output.includes('successfully installed') ||
        output.includes('successfully upgraded') ||
        output.includes('installer succeeded') ||
        output.includes('no available upgrade')

      // If we got stdout without throwing, and it doesn't contain clear failure
      // indicators, treat it as success (winget exit codes are unreliable)
      const hasClearFailure =
        output.includes('installer failed') ||
        output.includes('no package found') ||
        output.includes('no applicable update') ||
        output.includes('another version of this application') ||
        output.includes('installer aborted')

      if (wasSuccessful || !hasClearFailure) {
        succeeded++
        onProgress({
          phase: 'updating',
          current: i + 1,
          total: appIds.length,
          currentApp: appId,
          percent: Math.round(((i + 1) / appIds.length) * 100),
          status: 'done',
        })
      } else {
        throw new Error(upgradeStdout.trim().split('\n').pop() || 'Upgrade failed')
      }
    } catch (err) {
      failed++
      const rawMsg = err instanceof Error ? err.message : 'Unknown error'
      // Extract a cleaner reason from verbose winget output
      const lastLine = cleanOutput(rawMsg).trim().split('\n').pop() || rawMsg
      errors.push({
        appId,
        name: appId,
        reason: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine,
      })
      onProgress({
        phase: 'updating',
        current: i + 1,
        total: appIds.length,
        currentApp: appId,
        percent: Math.round(((i + 1) / appIds.length) * 100),
        status: 'failed',
      })
    }
  }

  return { succeeded, failed, errors }
}
