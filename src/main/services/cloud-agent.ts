import { app } from 'electron'
import * as si from 'systeminformation'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import { getSettings, setSettings } from './settings-store'
import { scanDirectory, cleanItems } from './file-utils'
import { cacheItems } from './scan-cache'
import { SYSTEM_PATHS } from '../constants/paths'
import { CleanerType } from '../../shared/enums'
import { checkForUpdates, runUpdates } from './software-updater'
import { scanRegistry } from '../ipc/registry-cleaner.ipc'
import { scanMalware } from '../ipc/malware-scanner.ipc'
import { scanPrivacy } from '../ipc/privacy-shield.ipc'
import { scanServices } from '../ipc/service-manager.ipc'
import { scanDriverUpdates } from '../ipc/driver-manager.ipc'
import { scanNetwork } from '../ipc/network-cleanup.ipc'
import { logInfo, logError } from './logger'
import type {
  CloudAgentStatus,
  CloudAgentState,
  CloudCommand,
  CloudMessage,
  TelemetrySnapshot,
  HealthReport,
  AllowedScanType,
} from './cloud-agent-types'
import type { ScanResult } from '../../shared/types'

const CLOUD_WS_URL = 'wss://api.dustforge.net/agent/ws'
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RECONNECT_DELAY_MS = 60_000
const HEALTH_REPORT_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

class CloudAgentService {
  private ws: WebSocket | null = null
  private status: CloudAgentStatus = 'dormant'
  private apiKey: string = ''
  private deviceId: string = ''
  private telemetryTimer: ReturnType<typeof setInterval> | null = null
  private healthReportTimer: ReturnType<typeof setInterval> | null = null
  private healthReportInitTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private authTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay: number = 1000
  private telemetryTick: number = 0
  private lastTelemetryAt: string | null = null
  private lastHealthReportAt: string | null = null
  private lastCommandAt: string | null = null
  private linkedAt: string | null = null
  private error: string | null = null
  private commandRunning: boolean = false
  private healthReportRunning: boolean = false
  private lastCommandFinishedAt: number = 0

  // ─── Public API ─────────────────────────────────────────

  getStatus(): CloudAgentState {
    const settings = getSettings()
    const key = settings.cloud.apiKey
    return {
      status: this.status,
      maskedApiKey: key ? (key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****') : null,
      deviceId: this.deviceId || null,
      linkedAt: this.linkedAt,
      lastTelemetryAt: this.lastTelemetryAt,
      lastHealthReportAt: this.lastHealthReportAt,
      lastCommandAt: this.lastCommandAt,
      error: this.error,
    }
  }

  async link(apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Stop any existing connection before re-linking
      this.stop()

      const settings = getSettings()
      const deviceId = settings.cloud.deviceId || randomUUID()

      setSettings({ cloud: { ...settings.cloud, apiKey, deviceId } })

      this.apiKey = apiKey
      this.deviceId = deviceId
      this.linkedAt = new Date().toISOString()
      this.error = null

      this.start()
      logInfo('Cloud agent linked')
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError(`Cloud agent link failed: ${msg}`)
      return { success: false, error: msg }
    }
  }

  async unlink(): Promise<void> {
    this.stop()
    const settings = getSettings()
    setSettings({ cloud: { ...settings.cloud, apiKey: '', deviceId: '' } })
    this.apiKey = ''
    this.deviceId = ''
    this.linkedAt = null
    this.error = null
    logInfo('Cloud agent unlinked')
  }

  start(): void {
    const settings = getSettings()
    this.apiKey = settings.cloud.apiKey
    this.deviceId = settings.cloud.deviceId

    if (!this.apiKey) {
      this.status = 'dormant'
      return
    }

    this.connect()
  }

  stop(): void {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer)
      this.telemetryTimer = null
    }
    if (this.healthReportTimer) {
      clearInterval(this.healthReportTimer)
      this.healthReportTimer = null
    }
    if (this.healthReportInitTimer) {
      clearTimeout(this.healthReportInitTimer)
      this.healthReportInitTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer)
      this.authTimeoutTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.status = 'dormant'
    this.reconnectDelay = 1000
  }

  // ─── WebSocket ──────────────────────────────────────────

  private connect(): void {
    this.status = 'connecting'
    this.error = null

    try {
      this.ws = new WebSocket(CLOUD_WS_URL)
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'WebSocket creation failed'
      this.status = 'error'
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this.send({
        type: 'auth',
        apiKey: this.apiKey,
        deviceId: this.deviceId,
        appVersion: app.getVersion(),
        hostname: hostname(),
      })
      // Stay in 'connecting' until server confirms auth — don't accept
      // commands or start telemetry until we receive an 'auth-ok' message
      logInfo('Cloud agent sent auth, waiting for confirmation')

      // Timeout if server doesn't respond to auth within 30 seconds
      this.authTimeoutTimer = setTimeout(() => {
        this.authTimeoutTimer = null
        if (this.status === 'connecting') {
          this.error = 'Auth timeout — server did not respond'
          this.status = 'error'
          logError('Cloud agent auth timeout')
          this.ws?.close()
        }
      }, 30_000)
    }

    this.ws.onmessage = (event) => {
      try {
        const data = typeof event.data === 'string' ? event.data : ''
        this.onMessage(data)
      } catch {
        // Ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      this.onClose()
    }

    this.ws.onerror = () => {
      // onclose will fire after this
    }
  }

  private onMessage(raw: string): void {
    // Reject oversized messages to prevent memory exhaustion
    if (raw.length > 64 * 1024) return

    let cmd: CloudCommand
    try {
      cmd = JSON.parse(raw)
    } catch {
      return
    }

    // Ensure parsed result is a non-null object
    if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) return

    if (cmd.type === 'ping') {
      this.send({ type: 'pong' })
      return
    }

    // Server must confirm auth before we accept commands or start telemetry
    if (cmd.type === 'auth-ok') {
      if (this.status === 'connecting') {
        if (this.authTimeoutTimer) {
          clearTimeout(this.authTimeoutTimer)
          this.authTimeoutTimer = null
        }
        this.status = 'connected'
        this.error = null
        this.startTelemetry()
        this.startHealthReports()
        logInfo('Cloud agent authenticated and connected')
      }
      return
    }

    if (cmd.type === 'auth-error') {
      const reason = 'error' in cmd && typeof cmd.error === 'string' ? cmd.error : 'Authentication failed'
      this.error = reason.slice(0, 200)
      this.status = 'error'
      logError(`Cloud agent auth rejected: ${this.error}`)
      this.ws?.close()
      return
    }

    // Reject all commands until authenticated
    if (this.status !== 'connected') return

    if (!('requestId' in cmd) || typeof cmd.requestId !== 'string' || cmd.requestId.length > 200) return

    const allowedTypes = new Set([
      'scan', 'clean', 'software-update-check', 'software-update-run',
      'get-status', 'get-system-info', 'get-health-report',
    ])
    if (!allowedTypes.has(cmd.type)) return

    this.lastCommandAt = new Date().toISOString()
    this.executeCommand(cmd)
  }

  private onClose(): void {
    if (this.status === 'dormant') return
    this.ws = null
    this.status = 'disconnected'

    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer)
      this.telemetryTimer = null
    }
    if (this.healthReportTimer) {
      clearInterval(this.healthReportTimer)
      this.healthReportTimer = null
    }
    if (this.healthReportInitTimer) {
      clearTimeout(this.healthReportInitTimer)
      this.healthReportInitTimer = null
    }
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer)
      this.authTimeoutTimer = null
    }

    logInfo('Cloud agent disconnected, scheduling reconnect')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (this.status === 'dormant') return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.status !== 'dormant' && this.apiKey) {
        this.connect()
      }
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  private send(msg: CloudMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  // ─── Telemetry (frequent, lightweight) ──────────────────

  private startTelemetry(): void {
    if (this.telemetryTimer) return

    const settings = getSettings()
    const intervalMs = (settings.cloud.telemetryIntervalSec || 60) * 1000

    // Send first telemetry immediately
    this.collectAndSendTelemetry()

    this.telemetryTimer = setInterval(() => {
      this.collectAndSendTelemetry()
    }, intervalMs)
  }

  private async collectAndSendTelemetry(): Promise<void> {
    try {
      const settings = getSettings()
      this.telemetryTick++

      const [load, mem, diskIO, netStats, time, fsSize] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.disksIO(),
        si.networkStats(),
        si.time(),
        si.fsSize(),
      ])

      const snapshot: TelemetrySnapshot = {
        cpu: load.currentLoad,
        memoryPercent: (mem.active / mem.total) * 100,
        memoryUsedBytes: mem.active,
        memoryTotalBytes: mem.total,
        diskReadBps: diskIO.rIO_sec ?? 0,
        diskWriteBps: diskIO.wIO_sec ?? 0,
        networkRxBps: netStats.reduce((s, n) => s + n.rx_sec, 0),
        networkTxBps: netStats.reduce((s, n) => s + n.tx_sec, 0),
        uptime: time.uptime ?? 0,
        disks: fsSize.map((d) => ({
          fs: d.fs,
          size: d.size,
          used: d.used,
          available: d.available,
          mount: d.mount,
        })),
      }

      // Include disk health every 10th tick (~10 minutes at default interval)
      if (settings.cloud.shareDiskHealth && this.telemetryTick % 10 === 0) {
        try {
          const disks = await si.diskLayout()
          snapshot.diskHealth = disks.map((d) => ({
            device: d.name,
            healthStatus: d.smartStatus || 'Unknown',
            temperature: d.temperature ?? null,
          }))
        } catch {
          // Disk health is optional
        }
      }

      // Include top processes every 5th tick (~5 minutes at default interval)
      if (settings.cloud.shareProcessList && this.telemetryTick % 5 === 0) {
        try {
          const data = await si.processes()
          // Sort by CPU + memory, take top 20 — only send name and resource usage, no PIDs/users/paths
          const sorted = data.list
            .sort((a, b) => (b.cpu + b.memRss) - (a.cpu + a.memRss))
            .slice(0, 20)
          snapshot.topProcesses = sorted.map((p) => ({
            name: p.name,
            cpuPercent: Math.round(p.cpu * 100) / 100,
            memPercent: mem.total > 0 ? Math.round((p.memRss / mem.total) * 10000) / 100 : 0,
          }))
        } catch {
          // Process list is optional
        }
      }

      this.send({
        type: 'telemetry',
        deviceId: this.deviceId,
        timestamp: Date.now(),
        snapshot,
      })

      this.lastTelemetryAt = new Date().toISOString()
    } catch (err) {
      logError(`Cloud telemetry collection failed: ${err}`)
    }
  }

  // ─── Health Reports (infrequent, comprehensive) ─────────

  private startHealthReports(): void {
    if (this.healthReportTimer) return

    // First health report after 2 minutes (let app settle)
    this.healthReportInitTimer = setTimeout(() => {
      this.healthReportInitTimer = null
      if (this.status === 'connected') {
        this.collectAndSendHealthReport()
      }
    }, 2 * 60 * 1000)

    this.healthReportTimer = setInterval(() => {
      if (this.status === 'connected') {
        this.collectAndSendHealthReport()
      }
    }, HEALTH_REPORT_INTERVAL_MS)
  }

  private async collectAndSendHealthReport(): Promise<void> {
    // Prevent concurrent health reports (timer vs command overlap)
    if (this.healthReportRunning) return
    this.healthReportRunning = true

    try {
      logInfo('Cloud agent: collecting health report')

      const report: HealthReport = {
        registry: { totalIssues: 0, byType: {}, byRisk: {} },
        softwareUpdates: { totalAvailable: 0, bySeverity: {}, apps: [] },
        driverUpdates: { totalAvailable: 0, drivers: [] },
        services: { totalRunning: 0, totalDisabled: 0, safeToDisable: 0, byCategory: {} },
        privacy: { score: 0, total: 0, protected: 0, byCategory: {} },
        malware: { threatsFound: 0, filesScanned: 0, bySeverity: {}, threats: [] },
        securityPosture: {
          antivirus: { enabled: false, realTimeProtection: false, signatureAge: null, productName: null },
          firewall: { domain: false, private: false, public: false },
          bitlocker: { volumes: [] },
          windowsUpdate: { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null },
        },
      }

      // Run all scans concurrently — each one is independent and safe to fail
      const results = await Promise.allSettled([
        this.collectRegistryHealth(),
        this.collectSoftwareUpdateHealth(),
        this.collectDriverUpdateHealth(),
        this.collectServiceHealth(),
        this.collectPrivacyHealth(),
        this.collectMalwareHealth(),
        this.collectSecurityPosture(),
      ])

      if (results[0].status === 'fulfilled') report.registry = results[0].value
      if (results[1].status === 'fulfilled') report.softwareUpdates = results[1].value
      if (results[2].status === 'fulfilled') report.driverUpdates = results[2].value
      if (results[3].status === 'fulfilled') report.services = results[3].value
      if (results[4].status === 'fulfilled') report.privacy = results[4].value
      if (results[5].status === 'fulfilled') report.malware = results[5].value
      if (results[6].status === 'fulfilled') report.securityPosture = results[6].value

      this.send({
        type: 'health-report',
        deviceId: this.deviceId,
        timestamp: Date.now(),
        report,
      })

      this.lastHealthReportAt = new Date().toISOString()
      logInfo('Cloud agent: health report sent')
    } catch (err) {
      logError(`Cloud health report failed: ${err}`)
    } finally {
      this.healthReportRunning = false
    }
  }

  private async collectRegistryHealth(): Promise<HealthReport['registry']> {
    const entries = await scanRegistry()
    const byType: Record<string, number> = {}
    const byRisk: Record<string, number> = {}
    for (const e of entries) {
      byType[e.type] = (byType[e.type] || 0) + 1
      byRisk[e.risk] = (byRisk[e.risk] || 0) + 1
    }
    return { totalIssues: entries.length, byType, byRisk }
  }

  private async collectSoftwareUpdateHealth(): Promise<HealthReport['softwareUpdates']> {
    const result = await checkForUpdates()
    const bySeverity: Record<string, number> = {}
    for (const a of result.apps) {
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1
    }
    return {
      totalAvailable: result.totalCount,
      bySeverity,
      apps: result.apps.map((a) => ({
        id: a.id,
        name: a.name,
        current: a.currentVersion,
        available: a.availableVersion,
        severity: a.severity,
      })),
    }
  }

  private async collectDriverUpdateHealth(): Promise<HealthReport['driverUpdates']> {
    const result = await scanDriverUpdates()
    return {
      totalAvailable: result.totalAvailable,
      drivers: result.updates.map((d) => ({
        deviceName: d.deviceName,
        className: d.className,
        currentVersion: d.currentVersion,
        availableVersion: d.availableVersion,
      })),
    }
  }

  private async collectServiceHealth(): Promise<HealthReport['services']> {
    const result = await scanServices()
    const byCategory: Record<string, { total: number; running: number; safeToDisable: number }> = {}
    for (const s of result.services) {
      if (!byCategory[s.category]) {
        byCategory[s.category] = { total: 0, running: 0, safeToDisable: 0 }
      }
      byCategory[s.category].total++
      if (s.status === 'Running') byCategory[s.category].running++
      if (s.safety === 'safe') byCategory[s.category].safeToDisable++
    }
    return {
      totalRunning: result.runningCount,
      totalDisabled: result.disabledCount,
      safeToDisable: result.safeToDisableCount,
      byCategory,
    }
  }

  private async collectPrivacyHealth(): Promise<HealthReport['privacy']> {
    const result = await scanPrivacy()
    const byCategory: Record<string, { total: number; protected: number }> = {}
    for (const s of result.settings) {
      if (!byCategory[s.category]) {
        byCategory[s.category] = { total: 0, protected: 0 }
      }
      byCategory[s.category].total++
      if (s.enabled) byCategory[s.category].protected++
    }
    return {
      score: result.score,
      total: result.total,
      protected: result.protected,
      byCategory,
    }
  }

  private async collectMalwareHealth(): Promise<HealthReport['malware']> {
    const result = await scanMalware()
    const bySeverity: Record<string, number> = {}
    for (const t of result.threats) {
      bySeverity[t.severity] = (bySeverity[t.severity] || 0) + 1
    }
    return {
      threatsFound: result.threats.length,
      filesScanned: result.filesScanned,
      bySeverity,
      // Don't send full file paths to cloud — just filename, detection, severity
      threats: result.threats.map((t) => ({
        fileName: t.fileName,
        detectionName: t.detectionName,
        severity: t.severity,
        source: t.source,
      })),
    }
  }

  // ─── Security Posture (native Windows checks) ──────────

  private async collectSecurityPosture(): Promise<HealthReport['securityPosture']> {
    const [av, fw, bl, wu] = await Promise.allSettled([
      this.collectAntivirusStatus(),
      this.collectFirewallStatus(),
      this.collectBitLockerStatus(),
      this.collectWindowsUpdateStatus(),
    ])

    return {
      antivirus: av.status === 'fulfilled' ? av.value : { enabled: false, realTimeProtection: false, signatureAge: null, productName: null },
      firewall: fw.status === 'fulfilled' ? fw.value : { domain: false, private: false, public: false },
      bitlocker: bl.status === 'fulfilled' ? bl.value : { volumes: [] },
      windowsUpdate: wu.status === 'fulfilled' ? wu.value : { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null },
    }
  }

  private async collectAntivirusStatus(): Promise<HealthReport['securityPosture']['antivirus']> {
    // Use Get-MpComputerStatus for Defender-specific rich detail
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated,AntivirusSignatureAge | ConvertTo-Json -Compress',
    ], { timeout: 15_000, windowsHide: true })

    const data = JSON.parse(stdout.trim())
    return {
      enabled: data.AntivirusEnabled === true,
      realTimeProtection: data.RealTimeProtectionEnabled === true,
      signatureAge: typeof data.AntivirusSignatureAge === 'number' ? data.AntivirusSignatureAge : null,
      productName: 'Windows Defender',
    }
  }

  private async collectFirewallStatus(): Promise<HealthReport['securityPosture']['firewall']> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress',
    ], { timeout: 15_000, windowsHide: true })

    const profiles: Array<{ Name: string; Enabled: boolean }> = JSON.parse(stdout.trim())
    // Normalize — profiles is always an array (3 profiles: Domain, Private, Public)
    const list = Array.isArray(profiles) ? profiles : [profiles]
    const lookup = Object.fromEntries(list.map((p) => [p.Name?.toLowerCase(), p.Enabled === true]))

    return {
      domain: lookup['domain'] ?? false,
      private: lookup['private'] ?? false,
      public: lookup['public'] ?? false,
    }
  }

  private async collectBitLockerStatus(): Promise<HealthReport['securityPosture']['bitlocker']> {
    // BitLocker requires admin — gracefully return empty if unavailable
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-BitLockerVolume | Select-Object MountPoint,VolumeStatus,ProtectionStatus | ConvertTo-Json -Compress',
      ], { timeout: 15_000, windowsHide: true })

      const raw = JSON.parse(stdout.trim())
      const vols: Array<{ MountPoint: string; VolumeStatus: number; ProtectionStatus: number }> =
        Array.isArray(raw) ? raw : [raw]

      // VolumeStatus: 0=FullyDecrypted, 1=FullyEncrypted, 2=EncryptionInProgress, 3=DecryptionInProgress
      const statusMap: Record<number, HealthReport['securityPosture']['bitlocker']['volumes'][0]['status']> = {
        0: 'FullyDecrypted', 1: 'FullyEncrypted', 2: 'EncryptionInProgress', 3: 'DecryptionInProgress',
      }

      return {
        volumes: vols.map((v) => ({
          mount: v.MountPoint ?? '',
          status: statusMap[v.VolumeStatus] ?? 'Unknown',
          protectionOn: v.ProtectionStatus === 1,
        })),
      }
    } catch {
      // BitLocker cmdlet not available (Home edition) or not admin
      return { volumes: [] }
    }
  }

  private async collectWindowsUpdateStatus(): Promise<HealthReport['securityPosture']['windowsUpdate']> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-HotFix | Sort-Object InstalledOn -Descending -ErrorAction SilentlyContinue | Select-Object -First 10 HotFixID,InstalledOn,Description | ConvertTo-Json -Compress',
    ], { timeout: 15_000, windowsHide: true })

    const raw = JSON.parse(stdout.trim())
    const patches: Array<{ HotFixID: string; InstalledOn: string; Description: string }> =
      Array.isArray(raw) ? raw : [raw]

    // InstalledOn comes as a .NET DateTime string — parse to ISO date
    const recentPatches = patches
      .filter((p) => p.HotFixID && p.InstalledOn)
      .map((p) => {
        const date = new Date(p.InstalledOn)
        return {
          id: p.HotFixID,
          installedOn: isNaN(date.getTime()) ? p.InstalledOn : date.toISOString().split('T')[0],
          description: (p.Description || '').slice(0, 100),
        }
      })

    let lastPatchDate: string | null = null
    let daysSinceLastPatch: number | null = null
    if (recentPatches.length > 0) {
      lastPatchDate = recentPatches[0].installedOn
      const lastDate = new Date(lastPatchDate)
      if (!isNaN(lastDate.getTime())) {
        daysSinceLastPatch = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
      }
    }

    return { recentPatches, lastPatchDate, daysSinceLastPatch }
  }

  // ─── Command Execution ──────────────────────────────────

  private async executeCommand(cmd: CloudCommand): Promise<void> {
    if (this.commandRunning) {
      if ('requestId' in cmd) {
        this.sendResult(cmd.requestId, false, undefined, 'Another command is already running')
      }
      return
    }

    // Rate limit: minimum 5 seconds between commands to prevent resource exhaustion
    const elapsed = Date.now() - this.lastCommandFinishedAt
    if (elapsed < 5_000) {
      if ('requestId' in cmd) {
        this.sendResult(cmd.requestId, false, undefined, 'Rate limited — try again shortly')
      }
      return
    }

    this.commandRunning = true
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      this.commandRunning = false
      if ('requestId' in cmd) {
        this.sendResult(cmd.requestId, false, undefined, 'Command timed out')
      }
    }, COMMAND_TIMEOUT_MS)

    try {
      switch (cmd.type) {
        case 'scan':
          await this.handleScan(cmd.requestId, cmd.scanType)
          break
        case 'clean':
          await this.handleClean(cmd.requestId, cmd.itemIds)
          break
        case 'software-update-check':
          await this.handleUpdateCheck(cmd.requestId)
          break
        case 'software-update-run':
          await this.handleUpdateRun(cmd.requestId, cmd.appIds)
          break
        case 'get-status':
          await this.handleGetStatus(cmd.requestId)
          break
        case 'get-system-info':
          await this.handleGetSystemInfo(cmd.requestId)
          break
        case 'get-health-report':
          await this.collectAndSendHealthReport()
          this.sendResult(cmd.requestId, true, { sent: true })
          break
      }
    } catch (err) {
      if (!timedOut) {
        // Truncate error messages to avoid leaking local paths or sensitive info
        const raw = err instanceof Error ? err.message : String(err)
        const msg = raw.length > 200 ? raw.slice(0, 200) : raw
        if ('requestId' in cmd) {
          this.sendResult(cmd.requestId, false, undefined, msg)
        }
      }
    } finally {
      clearTimeout(timeout)
      if (!timedOut) {
        this.commandRunning = false
        this.lastCommandFinishedAt = Date.now()
      }
    }
  }

  private sendResult(requestId: string, success: boolean, data?: unknown, error?: string): void {
    this.send({ type: 'command-result', requestId, success, data, error })
  }

  // ─── Command Handlers ──────────────────────────────────

  private async handleScan(requestId: string, scanType: AllowedScanType): Promise<void> {
    const validScanTypes = new Set<string>([
      'system', 'browser', 'app', 'gaming', 'registry',
      'malware', 'network', 'recycle-bin', 'uninstall-leftovers',
    ])
    if (typeof scanType !== 'string' || !validScanTypes.has(scanType)) {
      this.sendResult(requestId, false, undefined, 'Invalid scan type')
      return
    }

    switch (scanType) {
      case 'system': {
        const results: ScanResult[] = []
        const targets = [
          { path: SYSTEM_PATHS.userTemp, sub: 'User Temp Files' },
          { path: SYSTEM_PATHS.systemTemp, sub: 'System Temp Files' },
          { path: SYSTEM_PATHS.thumbnailCache, sub: 'Thumbnail & Icon Cache' },
          { path: SYSTEM_PATHS.dxShaderCache, sub: 'DirectX Shader Cache' },
          { path: SYSTEM_PATHS.inetCache, sub: 'Internet Cache' },
          { path: SYSTEM_PATHS.errorReports, sub: 'Error Reports' },
          { path: SYSTEM_PATHS.crashDumps, sub: 'Crash Dumps' },
        ]
        for (const t of targets) {
          try {
            const r = await scanDirectory(t.path, CleanerType.System, t.sub)
            if (r.items.length > 0) { cacheItems(r.items); results.push(r) }
          } catch { /* skip */ }
        }
        // Strip local file paths — only send IDs, sizes, and categories to cloud
        this.sendResult(requestId, true, {
          scanType,
          results: results.map((r) => ({
            category: r.category,
            subcategory: r.subcategory,
            totalSize: r.totalSize,
            itemCount: r.itemCount,
            items: r.items.map((i) => ({ id: i.id, size: i.size, category: i.category, subcategory: i.subcategory })),
          })),
          totalSize: results.reduce((s, r) => s + r.totalSize, 0),
          totalItems: results.reduce((s, r) => s + r.itemCount, 0),
        })
        return
      }

      case 'registry': {
        const entries = await scanRegistry()
        // Strip registry key paths and issue text (contains local file paths)
        this.sendResult(requestId, true, {
          scanType,
          entries: entries.map((e) => ({ id: e.id, type: e.type, risk: e.risk })),
          totalIssues: entries.length,
        })
        return
      }

      case 'malware': {
        const result = await scanMalware()
        // Strip full file paths — only send filename, detection info, and severity
        this.sendResult(requestId, true, {
          scanType,
          filesScanned: result.filesScanned,
          duration: result.duration,
          threats: result.threats.map((t) => ({
            id: t.id,
            fileName: t.fileName,
            detectionName: t.detectionName,
            severity: t.severity,
            source: t.source,
          })),
        })
        return
      }

      case 'network': {
        const items = await scanNetwork()
        // Only send IDs and types — labels may contain wifi network names or other sensitive info
        this.sendResult(requestId, true, {
          scanType,
          items: items.map((i) => ({ id: i.id, type: i.type })),
          totalItems: items.length,
        })
        return
      }

      default:
        this.sendResult(requestId, false, undefined, 'Scan type not yet supported via cloud')
        return
    }
  }

  private async handleClean(requestId: string, itemIds: string[]): Promise<void> {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 1000) {
      this.sendResult(requestId, false, undefined, 'Invalid itemIds')
      return
    }
    if (itemIds.some((id) => typeof id !== 'string' || id.length > 200)) {
      this.sendResult(requestId, false, undefined, 'Invalid itemIds')
      return
    }
    const result = await cleanItems(itemIds)
    // Strip local file paths from error details before sending to cloud
    this.sendResult(requestId, true, {
      totalCleaned: result.totalCleaned,
      filesDeleted: result.filesDeleted,
      filesSkipped: result.filesSkipped,
      errorCount: result.errors.length,
      needsElevation: result.needsElevation,
    })
  }

  private async handleUpdateCheck(requestId: string): Promise<void> {
    const result = await checkForUpdates()
    // Only send apps that need updates — don't expose full installed software inventory
    this.sendResult(requestId, true, {
      apps: result.apps.map((a) => ({
        id: a.id,
        name: a.name,
        currentVersion: a.currentVersion,
        availableVersion: a.availableVersion,
        severity: a.severity,
      })),
      totalCount: result.totalCount,
      majorCount: result.majorCount,
      minorCount: result.minorCount,
      patchCount: result.patchCount,
      wingetAvailable: result.wingetAvailable,
    })
  }

  private async handleUpdateRun(requestId: string, appIds: string[]): Promise<void> {
    if (!Array.isArray(appIds) || appIds.length === 0 || appIds.length > 100) {
      this.sendResult(requestId, false, undefined, 'Invalid appIds')
      return
    }
    if (appIds.some((id) => typeof id !== 'string' || id.length > 200)) {
      this.sendResult(requestId, false, undefined, 'Invalid appIds')
      return
    }
    const result = await runUpdates(appIds, () => {})
    // Strip raw error reasons which may contain local paths or system info
    this.sendResult(requestId, true, {
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((e) => ({ appId: e.appId, name: e.name })),
    })
  }

  private async handleGetStatus(requestId: string): Promise<void> {
    const [load, mem, diskIO, netStats, time, fsSize] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.disksIO(),
      si.networkStats(),
      si.time(),
      si.fsSize(),
    ])

    this.sendResult(requestId, true, {
      cpu: load.currentLoad,
      memoryPercent: (mem.active / mem.total) * 100,
      memoryUsedBytes: mem.active,
      memoryTotalBytes: mem.total,
      diskReadBps: diskIO.rIO_sec ?? 0,
      diskWriteBps: diskIO.wIO_sec ?? 0,
      networkRxBps: netStats.reduce((s, n) => s + n.rx_sec, 0),
      networkTxBps: netStats.reduce((s, n) => s + n.tx_sec, 0),
      uptime: time.uptime ?? 0,
      disks: fsSize.map((d) => ({
        fs: d.fs, size: d.size, used: d.used, available: d.available, mount: d.mount,
      })),
    })
  }

  private async handleGetSystemInfo(requestId: string): Promise<void> {
    const [cpu, osInfo, mem, disks] = await Promise.all([
      si.cpu(),
      si.osInfo(),
      si.mem(),
      si.diskLayout(),
    ])

    this.sendResult(requestId, true, {
      cpu: { model: `${cpu.manufacturer} ${cpu.brand}`, cores: cpu.physicalCores, threads: cpu.cores },
      os: { distro: osInfo.distro, release: osInfo.release, hostname: osInfo.hostname },
      memory: { total: mem.total, available: mem.available },
      disks: disks.map((d) => ({ name: d.name, size: d.size, type: d.type })),
    })
  }
}

export const cloudAgent = new CloudAgentService()
