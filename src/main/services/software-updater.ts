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
import { isAdmin } from './elevation'

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

function emptyResult(
  packageManagerAvailable: boolean,
  packageManagerName: UpdateCheckResult['packageManagerName'],
): UpdateCheckResult {
  return {
    apps: [],
    upToDate: [],
    totalCount: 0,
    majorCount: 0,
    minorCount: 0,
    patchCount: 0,
    packageManagerAvailable,
    packageManagerName,
  }
}

// ─── Winget (Windows) ───────────────────────────────────────

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

async function checkForUpdatesWinget(): Promise<UpdateCheckResult> {
  const available = await isWingetAvailable()
  if (!available) {
    return emptyResult(false, 'winget')
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
        return emptyResult(true, 'winget')
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
      packageManagerAvailable: true,
      packageManagerName: 'winget',
    }
  } catch {
    return emptyResult(true, 'winget')
  }
}

const WINGET_UPGRADE_ARGS = [
  '--accept-source-agreements',
  '--accept-package-agreements',
  '--disable-interactivity',
  '--silent',
  '--include-unknown',
]

const SUCCESS_PATTERNS = [
  'successfully installed',
  'successfully upgraded',
  'installer succeeded',
  'no available upgrade',
]

const FAILURE_PATTERNS = [
  'installer failed',
  'no package found',
  'no applicable update',
  'another version of this application',
  'installer aborted',
]

const ELEVATION_HINTS = [
  'access is denied',
  'administrator',
  'elevation',
  'requires admin',
  'run as admin',
  '0x80070005', // E_ACCESSDENIED
]

/** Attempt a single winget upgrade and return {success, output} */
async function attemptWingetUpgrade(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string }> {
  // Validate appId format to prevent argument injection (e.g. --source flags)
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }
  let upgradeStdout = ''
  try {
    const result = await execFileAsync(
      'winget',
      ['upgrade', appId, ...WINGET_UPGRADE_ARGS, ...extraArgs],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    upgradeStdout = result.stdout
  } catch (err: any) {
    if (err?.stdout) {
      upgradeStdout = err.stdout
    } else {
      return { success: false, output: err?.message || 'Unknown error' }
    }
  }

  const output = cleanOutput(upgradeStdout).toLowerCase()
  const wasSuccessful = SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = FAILURE_PATTERNS.some((p) => output.includes(p))

  if (wasSuccessful || !hasClearFailure) {
    return { success: true, output: upgradeStdout }
  }
  return { success: false, output: upgradeStdout }
}

/** Retry a failed upgrade with elevation using PowerShell Start-Process -Verb RunAs */
async function attemptElevatedUpgrade(appId: string): Promise<{ success: boolean; output: string }> {
  // Validate appId format to prevent injection — winget IDs are alphanumeric with dots, dashes, underscores
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }

  try {
    const args = ['upgrade', appId, ...WINGET_UPGRADE_ARGS, '--force'].join(' ')
    // Escape single quotes for PowerShell single-quoted string ('' is the escape for ')
    const safeArgs = args.replace(/'/g, "''")
    // Run winget elevated via Start-Process; -Wait blocks until done, -PassThru gives exit code
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$p = Start-Process winget -ArgumentList '${safeArgs}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    // We can't reliably capture stdout from the elevated process, so verify
    // by checking if winget still lists this app as upgradeable
    const checkResult = await execFileAsync(
      'winget',
      ['upgrade', '--accept-source-agreements', '--disable-interactivity', '--include-unknown'],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const stillNeedsUpgrade = checkResult.stdout.includes(appId)
    return {
      success: !stillNeedsUpgrade,
      output: stillNeedsUpgrade ? 'App still needs upgrade after elevated attempt' : stdout,
    }
  } catch (err: any) {
    // UAC was likely denied by user
    return { success: false, output: err?.message || 'Elevated upgrade failed' }
  }
}

/** Concurrency limit for parallel winget upgrades */
const WINGET_UPDATE_CONCURRENCY = 3

/** Run a single app through the winget upgrade pipeline: normal → elevated → force */
async function upgradeAppWinget(
  appId: string,
  alreadyAdmin: boolean,
): Promise<{ success: boolean; error?: string }> {
  // First attempt: normal upgrade
  let result = await attemptWingetUpgrade(appId)

  // If failed and not already admin, retry with elevation
  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) ||
      FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      result = await attemptElevatedUpgrade(appId)
    }
  }

  // If still failed, retry once with --force (handles version mismatch issues)
  if (!result.success) {
    const retryResult = await attemptWingetUpgrade(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return { success: false, error: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine }
}

async function runUpdatesWinget(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: UpdateResult['errors'] = []
  const alreadyAdmin = isAdmin()
  const total = appIds.length

  // Process in concurrent batches
  for (let batchStart = 0; batchStart < total; batchStart += WINGET_UPDATE_CONCURRENCY) {
    const batch = appIds.slice(batchStart, batchStart + WINGET_UPDATE_CONCURRENCY)

    // Report all in-progress
    for (const appId of batch) {
      onProgress({
        phase: 'updating',
        current: completed + 1,
        total,
        currentApp: appId,
        percent: Math.round((completed / total) * 100),
        status: 'in-progress',
      })
    }

    const results = await Promise.allSettled(
      batch.map((appId) => upgradeAppWinget(appId, alreadyAdmin).then((r) => ({ appId, ...r }))),
    )

    for (const settled of results) {
      completed++
      if (settled.status === 'fulfilled' && settled.value.success) {
        succeeded++
        onProgress({
          phase: 'updating',
          current: completed,
          total,
          currentApp: settled.value.appId,
          percent: Math.round((completed / total) * 100),
          status: 'done',
        })
      } else {
        failed++
        const appId = settled.status === 'fulfilled' ? settled.value.appId : batch[results.indexOf(settled)]
        const reason = settled.status === 'fulfilled'
          ? (settled.value.error || 'Upgrade failed')
          : (settled.reason?.message || 'Unknown error')
        errors.push({ appId, name: appId, reason })
        onProgress({
          phase: 'updating',
          current: completed,
          total,
          currentApp: appId,
          percent: Math.round((completed / total) * 100),
          status: 'failed',
        })
      }
    }
  }

  return { succeeded, failed, errors }
}

// ─── Homebrew (macOS) ───────────────────────────────────────

/** Brew formula/cask name: lowercase alphanumeric, hyphens, dots, underscores, optional tap prefix */
const BREW_ID_PATTERN = /^[a-z0-9][a-z0-9@._+-]*(\/[a-z0-9][a-z0-9@._+-]*)?$/

interface BrewOutdatedFormula {
  name: string
  installed_versions: string[]
  current_version: string
}

interface BrewOutdatedCask {
  name: string
  token: string
  installed_versions: string
  current_version: string
}

interface BrewOutdatedJson {
  formulae: BrewOutdatedFormula[]
  casks: BrewOutdatedCask[]
}

interface BrewInfoFormula {
  name: string
  installed: { version: string }[]
  versions: { stable: string }
}

interface BrewInfoCask {
  token: string
  installed: string | null
  version: string
}

interface BrewInfoJson {
  formulae: BrewInfoFormula[]
  casks: BrewInfoCask[]
}

async function isBrewAvailable(): Promise<boolean> {
  try {
    await execFileAsync('brew', ['--version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

function parseBrewOutdatedJson(stdout: string): UpdatableApp[] {
  let data: BrewOutdatedJson
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }

  const apps: UpdatableApp[] = []

  for (const f of data.formulae ?? []) {
    const currentVersion = f.installed_versions?.[0] ?? ''
    apps.push({
      id: f.name,
      name: f.name,
      currentVersion,
      availableVersion: f.current_version,
      source: 'brew',
      severity: computeSeverity(currentVersion, f.current_version),
      selected: true,
    })
  }

  for (const c of data.casks ?? []) {
    const id = c.token || c.name
    const currentVersion = typeof c.installed_versions === 'string'
      ? c.installed_versions
      : ''
    apps.push({
      id,
      name: id,
      currentVersion,
      availableVersion: c.current_version,
      source: 'brew',
      severity: computeSeverity(currentVersion, c.current_version),
      selected: true,
    })
  }

  return apps
}

function parseBrewInstalledJson(stdout: string): UpToDateApp[] {
  let data: BrewInfoJson
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }

  const apps: UpToDateApp[] = []

  for (const f of data.formulae ?? []) {
    const version = f.installed?.[0]?.version ?? f.versions?.stable ?? ''
    if (!version) continue
    apps.push({ id: f.name, name: f.name, version, source: 'brew' })
  }

  for (const c of data.casks ?? []) {
    const version = c.installed ?? c.version ?? ''
    if (!version) continue
    apps.push({ id: c.token, name: c.token, version, source: 'brew' })
  }

  return apps
}

async function checkForUpdatesBrew(): Promise<UpdateCheckResult> {
  const available = await isBrewAvailable()
  if (!available) {
    return emptyResult(false, 'brew')
  }

  try {
    // Get outdated packages as JSON
    let outdatedStdout = ''
    try {
      const result = await execFileAsync(
        'brew',
        ['outdated', '--json=v2'],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      )
      outdatedStdout = result.stdout
    } catch (err: any) {
      if (err?.stdout) {
        outdatedStdout = err.stdout
      } else {
        return emptyResult(true, 'brew')
      }
    }

    const apps = parseBrewOutdatedJson(outdatedStdout)

    // Get all installed packages for the "up to date" list
    let upToDate: UpToDateApp[] = []
    try {
      let infoStdout = ''
      try {
        const infoResult = await execFileAsync(
          'brew',
          ['info', '--json=v2', '--installed'],
          { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
        )
        infoStdout = infoResult.stdout
      } catch (err: any) {
        if (err?.stdout) infoStdout = err.stdout
      }
      if (infoStdout) {
        const allApps = parseBrewInstalledJson(infoStdout)
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
      packageManagerAvailable: true,
      packageManagerName: 'brew',
    }
  } catch {
    return emptyResult(true, 'brew')
  }
}

/** Attempt a single brew upgrade */
async function attemptBrewUpgrade(
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (!BREW_ID_PATTERN.test(name) || name.length > 200) {
    return { success: false, error: 'Invalid package name format' }
  }

  try {
    await execFileAsync(
      'brew',
      ['upgrade', name],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
    )
    return { success: true }
  } catch (err: any) {
    const output = cleanOutput(err?.stderr || err?.stdout || err?.message || 'Unknown error')
    const lastLine = output.trim().split('\n').pop() || 'Upgrade failed'
    return { success: false, error: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine }
  }
}

async function runUpdatesBrew(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  const errors: UpdateResult['errors'] = []
  const total = appIds.length

  // brew doesn't handle parallel upgrades well — run sequentially
  for (let i = 0; i < total; i++) {
    const appId = appIds[i]
    onProgress({
      phase: 'updating',
      current: i + 1,
      total,
      currentApp: appId,
      percent: Math.round((i / total) * 100),
      status: 'in-progress',
    })

    const result = await attemptBrewUpgrade(appId)

    if (result.success) {
      succeeded++
      onProgress({
        phase: 'updating',
        current: i + 1,
        total,
        currentApp: appId,
        percent: Math.round(((i + 1) / total) * 100),
        status: 'done',
      })
    } else {
      failed++
      errors.push({ appId, name: appId, reason: result.error || 'Upgrade failed' })
      onProgress({
        phase: 'updating',
        current: i + 1,
        total,
        currentApp: appId,
        percent: Math.round(((i + 1) / total) * 100),
        status: 'failed',
      })
    }
  }

  return { succeeded, failed, errors }
}

// ─── Platform-dispatched exports ────────────────────────────

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (process.platform === 'darwin') return checkForUpdatesBrew()
  if (process.platform === 'win32') return checkForUpdatesWinget()
  return emptyResult(false, null)
}

export async function runUpdates(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  if (process.platform === 'darwin') return runUpdatesBrew(appIds, onProgress)
  if (process.platform === 'win32') return runUpdatesWinget(appIds, onProgress)
  return { succeeded: 0, failed: 0, errors: [] }
}

/** Validate an app ID for the current platform's package manager */
export function isValidAppId(id: string): boolean {
  if (process.platform === 'darwin') return BREW_ID_PATTERN.test(id) && id.length <= 200
  return /^[\w][\w.\-]{0,200}$/.test(id)
}
