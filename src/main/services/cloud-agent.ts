import { app } from 'electron'
import * as si from 'systeminformation'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import Pusher from 'pusher-js'

const execFileAsync = promisify(execFile)
import { getSettings, setSettings } from './settings-store'
import { scanDirectory, cleanItems } from './file-utils'
import { cacheItems } from './scan-cache'
import { SYSTEM_PATHS } from '../constants/paths'
import { CleanerType } from '../../shared/enums'
import { checkForUpdates, runUpdates } from './software-updater'
import { scanRegistry, fixRegistryEntries } from '../ipc/registry-cleaner.ipc'
import { scanMalware } from '../ipc/malware-scanner.ipc'
import { scanPrivacy } from '../ipc/privacy-shield.ipc'
import { scanServices } from '../ipc/service-manager.ipc'
import { scanDriverUpdates, installDriverUpdates, scanDrivers, cleanDrivers } from '../ipc/driver-manager.ipc'
import { scanNetwork } from '../ipc/network-cleanup.ipc'
import { listStartupItems, toggleStartupItem } from '../ipc/startup-manager.ipc'
import { applyPrivacySettings } from '../ipc/privacy-shield.ipc'
import { scanBloatware, removeBloatware } from '../ipc/debloater.ipc'
import { applyServiceChanges } from '../ipc/service-manager.ipc'
import { quarantineMalware, deleteMalware } from '../ipc/malware-scanner.ipc'
import { PerfMonitorService } from './perf-monitor'
import { logInfo, logError } from './logger'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import type {
  CloudAgentStatus,
  CloudAgentState,
  CloudCommand,
  TelemetrySnapshot,
  HealthReport,
  AllowedScanType,
} from './cloud-agent-types'
import type { ScanResult } from '../../shared/types'

const DEFAULT_SERVER_URL = app.isPackaged ? 'https://cloud.dustforge.net' : 'http://localhost:8000'

// ─── Cloud Agent Debug Log ──────────────────────────────────
const CLOUD_LOG_DIR = join(tmpdir(), 'dustforge-cloud')
const CLOUD_LOG_FILE = join(CLOUD_LOG_DIR, 'cloud-agent.log')
try { mkdirSync(CLOUD_LOG_DIR, { recursive: true }) } catch { /* ignore */ }

function cloudLog(level: 'INFO' | 'ERROR' | 'DEBUG', msg: string, data?: unknown): void {
  const ts = new Date().toISOString()
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `[${ts}] ${level}: ${msg}${extra}\n`
  try { appendFileSync(CLOUD_LOG_FILE, line) } catch { /* ignore */ }
  // Also write to main log for INFO/ERROR
  if (level === 'ERROR') logError(msg)
  else if (level === 'INFO') logInfo(msg)
}
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000
const HEALTH_REPORT_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

/** Connection config returned by GET {serverUrl}/api/connect */
interface ConnectConfig {
  ws: { host: string; port: number; key: string; tls: boolean }
  api: string
  broadcasting: string
}

class CloudAgentService {
  private pusher: Pusher | null = null
  private channel: ReturnType<Pusher['subscribe']> | null = null
  private status: CloudAgentStatus = 'dormant'
  private apiKey: string = ''
  private deviceId: string = ''
  private serverUrl: string = ''
  private connectConfig: ConnectConfig | null = null
  private telemetryTimer: ReturnType<typeof setInterval> | null = null
  private healthReportTimer: ReturnType<typeof setInterval> | null = null
  private healthReportInitTimer: ReturnType<typeof setTimeout> | null = null
  private telemetryTick: number = 0
  private lastTelemetryAt: string | null = null
  private lastHealthReportAt: string | null = null
  private lastCommandAt: string | null = null
  private linkedAt: string | null = null
  private error: string | null = null
  private commandRunning: boolean = false
  private healthReportRunning: boolean = false
  private lastCommandFinishedAt: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts: number = 0

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
      this.serverUrl = settings.cloud.serverUrl || DEFAULT_SERVER_URL

      this.apiKey = apiKey
      this.deviceId = deviceId

      // Discover server config and register device before persisting
      await this.discover()
      await this.postApi(`/devices/${this.deviceId}/register`, {
        appVersion: app.getVersion(),
        hostname: hostname(),
      })

      setSettings({ cloud: { ...settings.cloud, apiKey, deviceId } })
      this.linkedAt = new Date().toISOString()
      this.error = null

      this.start()
      cloudLog('INFO', `Linked device ${deviceId} to ${this.serverUrl}`)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      cloudLog('ERROR', `Link failed: ${msg}`)
      this.error = msg.slice(0, 200)
      this.status = 'error'
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
    cloudLog('INFO', 'Unlinked device')
  }

  async reconnect(): Promise<void> {
    cloudLog('INFO', 'Manual reconnect requested')
    // Tear down any existing connection/timers cleanly
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    if (this.channel) { this.channel.unbind_all(); this.channel = null }
    if (this.pusher) { this.pusher.disconnect(); this.pusher = null }
    if (this.telemetryTimer) { clearInterval(this.telemetryTimer); this.telemetryTimer = null }
    if (this.healthReportTimer) { clearInterval(this.healthReportTimer); this.healthReportTimer = null }
    if (this.healthReportInitTimer) { clearTimeout(this.healthReportInitTimer); this.healthReportInitTimer = null }
    await this.start()
  }

  async start(): Promise<void> {
    const settings = getSettings()
    this.apiKey = settings.cloud.apiKey
    this.deviceId = settings.cloud.deviceId
    this.serverUrl = settings.cloud.serverUrl || DEFAULT_SERVER_URL

    if (!this.apiKey) {
      this.status = 'dormant'
      return
    }

    this.clearReconnectTimer()

    try {
      this.status = 'connecting'
      this.error = null
      await this.discover()
      this.connect()
      this.reconnectAttempts = 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.error = `Discovery failed: ${msg.slice(0, 180)}`
      this.status = 'disconnected'
      cloudLog('ERROR', `Discovery failed: ${msg}`)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.status === 'dormant') return
    this.clearReconnectTimer()

    // Exponential backoff: 10s, 20s, 30s, 30s, 30s...
    this.reconnectAttempts++
    const delaySec = Math.min(10 * this.reconnectAttempts, 30)

    cloudLog('INFO', `Scheduling reconnect in ${delaySec}s (attempt ${this.reconnectAttempts})`)
    this.error = `Reconnecting in ${delaySec}s...`

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.status === 'dormant') return
      cloudLog('INFO', `Reconnect attempt ${this.reconnectAttempts}`)
      this.start()
    }, delaySec * 1000)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  stop(): void {
    this.clearReconnectTimer()
    this.reconnectAttempts = 0

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

    if (this.channel) {
      this.channel.unbind_all()
      this.pusher?.unsubscribe(`private-device.${this.deviceId}`)
      this.channel = null
    }
    if (this.pusher) {
      this.pusher.disconnect()
      this.pusher = null
    }

    this.status = 'dormant'
  }

  // ─── Reverb Connection (via pusher-js) ────────────────

  private connect(): void {
    if (!this.connectConfig) {
      this.error = 'No server config — call discover() first'
      this.status = 'error'
      return
    }

    const { ws, broadcasting } = this.connectConfig
    this.status = 'connecting'
    this.error = null

    try {
      this.pusher = new Pusher(ws.key, {
        wsHost: ws.host,
        wsPort: ws.port,
        wssPort: ws.port,
        forceTLS: ws.tls,
        disableStats: true,
        enabledTransports: ['ws', 'wss'],
        cluster: '',
        // Auth endpoint — Reverb validates API key + device ownership
        channelAuthorization: {
          endpoint: broadcasting,
          transport: 'ajax',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'X-Device-Id': this.deviceId,
          },
        },
      })

      this.pusher.connection.bind('connected', () => {
        cloudLog('INFO', 'Reverb connected, subscribing to channel')
        this.subscribeToChannel()
      })

      this.pusher.connection.bind('disconnected', () => {
        this.onDisconnected()
      })

      this.pusher.connection.bind('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : typeof err === 'object' && err !== null && 'error' in err
          ? String((err as { error: { data?: { message?: string } } }).error?.data?.message || 'Connection error')
          : 'Connection error'
        cloudLog('ERROR', `Reverb error: ${msg}`)
        // Surface the error so the UI can show it — onDisconnected will handle reconnect
        this.error = msg.slice(0, 200)
      })

    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Pusher creation failed'
      this.status = 'disconnected'
      cloudLog('ERROR', `Connect failed: ${this.error}`)
      this.scheduleReconnect()
    }
  }

  private subscribeToChannel(): void {
    if (!this.pusher) return

    const channelName = `private-device.${this.deviceId}`
    this.channel = this.pusher.subscribe(channelName)

    this.channel.bind('pusher:subscription_succeeded', () => {
      this.status = 'connected'
      this.error = null
      this.reconnectAttempts = 0
      cloudLog('INFO', `Subscribed to private-device.${this.deviceId}, starting telemetry`)
      this.startTelemetry()
      this.startHealthReports()
    })

    this.channel.bind('pusher:subscription_error', (err: unknown) => {
      const statusCode = typeof err === 'object' && err !== null && 'status' in err
        ? (err as Record<string, unknown>).status
        : null
      const msg = typeof err === 'object' && err !== null && 'error' in err
        ? String((err as Record<string, unknown>).error)
        : 'Channel subscription failed'
      this.error = msg.slice(0, 200)
      cloudLog('ERROR', `Channel auth failed (status ${statusCode}): ${this.error}`)

      // 401/403 = bad API key — don't retry, user needs to re-link
      if (statusCode === 401 || statusCode === 403) {
        this.status = 'error'
        this.pusher?.disconnect()
        return
      }

      // Transient failure (500, network, etc) — teardown and retry
      this.status = 'disconnected'
      this.pusher?.disconnect()
      this.pusher = null
      this.channel = null
      this.scheduleReconnect()
    })

    // Listen for commands from the server
    this.channel.bind('DeviceCommand', (data: unknown) => {
      cloudLog('DEBUG', 'Received DeviceCommand', data)
      this.onCommand(data)
    })

    this.channel.bind('DevicePing', (data: unknown) => {
      cloudLog('DEBUG', 'Received DevicePing')
      const cmd = data as { requestId?: string }
      if (cmd.requestId && typeof cmd.requestId === 'string' && cmd.requestId.length <= 200) {
        this.postCommandResult(cmd.requestId, true, { pong: true }).catch(() => {})
      }
    })
  }

  private onDisconnected(): void {
    if (this.status === 'dormant') return

    this.status = 'disconnected'
    // Preserve existing error if set (e.g. from connection.error), otherwise set a generic one
    if (!this.error) {
      this.error = 'Connection lost'
    }

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

    cloudLog('INFO', 'Reverb disconnected')

    // Clean up pusher instance and do a full reconnect (discover + connect)
    // This is more robust than relying on pusher-js auto-reconnect which
    // doesn't re-discover the server config or handle auth endpoint changes
    if (this.channel) {
      this.channel.unbind_all()
      this.channel = null
    }
    if (this.pusher) {
      this.pusher.disconnect()
      this.pusher = null
    }
    this.scheduleReconnect()
  }

  // ─── HTTP API Helpers ─────────────────────────────────

  /** Discover server config from GET {serverUrl}/api/connect */
  private async discover(): Promise<void> {
    cloudLog('DEBUG', `Discovery: GET ${this.serverUrl}/api/connect`)
    const res = await fetch(`${this.serverUrl}/api/connect`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!res.ok) {
      cloudLog('ERROR', `Discovery failed: HTTP ${res.status}`)
      throw new Error(`Discovery returned HTTP ${res.status}`)
    }
    const data = await res.json() as ConnectConfig
    if (!data?.ws?.host || !data?.ws?.key || !data?.api || !data?.broadcasting) {
      cloudLog('ERROR', 'Discovery response missing required fields', data)
      throw new Error('Invalid discovery response')
    }
    this.connectConfig = data
    cloudLog('INFO', 'Discovery complete', { wsHost: data.ws.host, wsPort: data.ws.port, tls: data.ws.tls, api: data.api, broadcasting: data.broadcasting })
  }

  private async postApi(path: string, body: unknown): Promise<unknown> {
    if (!this.connectConfig) throw new Error('Not connected — no server config')
    const url = `${this.connectConfig.api}${path}`
    cloudLog('DEBUG', `POST ${url}`)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      cloudLog('ERROR', `POST ${url} → ${res.status}`, text.slice(0, 300))
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    cloudLog('DEBUG', `POST ${url} → ${res.status}`)
    const contentType = res.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return res.json()
    }
    return null
  }

  private async postTelemetry(snapshot: TelemetrySnapshot): Promise<void> {
    await this.postApi(`/devices/${this.deviceId}/telemetry`, {
      timestamp: Date.now(),
      snapshot,
    })
  }

  private async postHealthReport(report: HealthReport): Promise<void> {
    await this.postApi(`/devices/${this.deviceId}/health-report`, {
      timestamp: Date.now(),
      report,
    })
  }

  private async postCommandResult(requestId: string, success: boolean, data?: unknown, error?: string): Promise<void> {
    await this.postApi(`/devices/${this.deviceId}/command-result`, {
      requestId,
      success,
      data,
      error,
    })
  }

  // ─── Command Handling ─────────────────────────────────

  private onCommand(raw: unknown): void {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
    if (this.status !== 'connected') return

    const cmd = raw as CloudCommand

    const allowedTypes = new Set([
      'scan', 'clean', 'software-update-check', 'software-update-run',
      'get-status', 'get-system-info', 'get-health-report',
      'shutdown', 'restart', 'windows-update-check', 'windows-update-install',
      'run-sfc', 'run-dism', 'get-network-config', 'get-event-log', 'get-installed-apps',
    ])
    if (!('type' in cmd) || !allowedTypes.has(cmd.type)) return
    if (!('requestId' in cmd) || typeof cmd.requestId !== 'string' || cmd.requestId.length > 200) return

    this.lastCommandAt = new Date().toISOString()
    this.executeCommand(cmd)
  }

  // ─── Telemetry (frequent, lightweight) ────────────────

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
        diskReadBps: diskIO?.rIO_sec ?? 0,
        diskWriteBps: diskIO?.wIO_sec ?? 0,
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

      await this.postTelemetry(snapshot)
      this.lastTelemetryAt = new Date().toISOString()
      cloudLog('DEBUG', `Telemetry sent (tick ${this.telemetryTick}, cpu=${snapshot.cpu.toFixed(1)}%, mem=${snapshot.memoryPercent.toFixed(1)}%)`)
    } catch (err) {
      cloudLog('ERROR', `Telemetry failed: ${err}`)
    }
  }

  // ─── Health Reports (infrequent, comprehensive) ───────

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
      cloudLog('DEBUG', 'Collecting health report')

      const report: HealthReport = {
        registry: { totalIssues: 0, byType: {}, byRisk: {} },
        softwareUpdates: { totalAvailable: 0, bySeverity: {}, apps: [] },
        driverUpdates: { totalAvailable: 0, drivers: [] },
        services: { totalRunning: 0, totalDisabled: 0, safeToDisable: 0, byCategory: {} },
        privacy: { score: 0, total: 0, protected: 0, byCategory: {} },
        malware: { threatsFound: 0, filesScanned: 0, bySeverity: {}, threats: [] },
        securityPosture: {
          antivirus: { products: [], primary: null },
          firewall: { enabled: false, products: [], windowsProfiles: { domain: false, private: false, public: false } },
          bitlocker: { volumes: [] },
          windowsUpdate: { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null },
          screenLock: { screenSaverEnabled: false, lockOnResume: false, timeoutSec: null, inactivityLockSec: null },
          passwordPolicy: { minLength: 0, maxAgeDays: 0, minAgeDays: 0, historyCount: 0, complexityRequired: false, lockoutThreshold: 0, lockoutDurationMin: 0, lockoutObservationMin: 0 },
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

      await this.postHealthReport(report)
      this.lastHealthReportAt = new Date().toISOString()
      cloudLog('INFO', 'Health report sent')
    } catch (err) {
      cloudLog('ERROR', `Health report failed: ${err}`)
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

  // ─── Security Posture (native Windows checks) ────────

  private async collectSecurityPosture(): Promise<HealthReport['securityPosture']> {
    const [av, fw, bl, wu, sl, pp] = await Promise.allSettled([
      this.collectAntivirusStatus(),
      this.collectFirewallStatus(),
      this.collectBitLockerStatus(),
      this.collectWindowsUpdateStatus(),
      this.collectScreenLockStatus(),
      this.collectPasswordPolicy(),
    ])

    return {
      antivirus: av.status === 'fulfilled' ? av.value : { products: [], primary: null },
      firewall: fw.status === 'fulfilled' ? fw.value : { enabled: false, products: [], windowsProfiles: { domain: false, private: false, public: false } },
      bitlocker: bl.status === 'fulfilled' ? bl.value : { volumes: [] },
      windowsUpdate: wu.status === 'fulfilled' ? wu.value : { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null },
      screenLock: sl.status === 'fulfilled' ? sl.value : { screenSaverEnabled: false, lockOnResume: false, timeoutSec: null, inactivityLockSec: null },
      passwordPolicy: pp.status === 'fulfilled' ? pp.value : { minLength: 0, maxAgeDays: 0, minAgeDays: 0, historyCount: 0, complexityRequired: false, lockoutThreshold: 0, lockoutDurationMin: 0, lockoutObservationMin: 0 },
    }
  }

  /**
   * Query WMI SecurityCenter2 for all registered AV products.
   * productState is a bitmask: bits 12-15 = enabled/disabled, bit 4 = out-of-date sigs,
   * bits 8-11 = real-time scanning state.
   */
  private async collectAntivirusStatus(): Promise<HealthReport['securityPosture']['antivirus']> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName,productState | ConvertTo-Json -Compress',
    ], { timeout: 15_000, windowsHide: true })

    const raw = JSON.parse(stdout.trim())
    const items: Array<{ displayName: string; productState: number }> =
      Array.isArray(raw) ? raw : [raw]

    const products = items.map((item) => {
      const state = item.productState
      // Byte 1 (bits 8-15): scanner status. 0x10 = enabled, 0x00/0x01 = disabled
      const enabled = ((state >> 12) & 0xF) >= 1
      // Bit 4: signature out of date
      const signatureUpToDate = ((state >> 4) & 0x1) === 0
      // Byte 1 lower nibble (bits 8-11): 0x00 = real-time on, 0x01 = off, 0x10 = snoozed
      const realTimeProtection = ((state >> 8) & 0xF) === 0
      return {
        name: item.displayName ?? 'Unknown',
        enabled,
        realTimeProtection: enabled && realTimeProtection,
        signatureUpToDate,
      }
    })

    // Primary = first product that is enabled with real-time protection, excluding Defender if a third-party is active
    const thirdParty = products.filter(
      (p) => p.enabled && p.realTimeProtection && p.name !== 'Windows Defender'
    )
    const primary = thirdParty[0]?.name ?? products.find((p) => p.enabled && p.realTimeProtection)?.name ?? null

    return { products, primary }
  }

  /**
   * Query both WMI SecurityCenter2 (third-party firewalls) and Windows Firewall profiles.
   */
  private async collectFirewallStatus(): Promise<HealthReport['securityPosture']['firewall']> {
    const [fwProducts, fwProfiles] = await Promise.allSettled([
      execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct | Select-Object displayName,productState | ConvertTo-Json -Compress',
      ], { timeout: 15_000, windowsHide: true }),
      execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress',
      ], { timeout: 15_000, windowsHide: true }),
    ])

    // Parse third-party firewall products
    const products: Array<{ name: string; enabled: boolean }> = []
    if (fwProducts.status === 'fulfilled') {
      try {
        const raw = JSON.parse(fwProducts.value.stdout.trim())
        const items: Array<{ displayName: string; productState: number }> =
          Array.isArray(raw) ? raw : [raw]
        for (const item of items) {
          const enabled = ((item.productState >> 12) & 0xF) >= 1
          products.push({ name: item.displayName ?? 'Unknown', enabled })
        }
      } catch { /* ignore parse errors */ }
    }

    // Parse Windows Firewall profiles
    const windowsProfiles = { domain: false, private: false, public: false }
    if (fwProfiles.status === 'fulfilled') {
      try {
        const raw = JSON.parse(fwProfiles.value.stdout.trim())
        const profiles: Array<{ Name: string; Enabled: number | boolean }> =
          Array.isArray(raw) ? raw : [raw]
        // Enabled is a GpoBoolean enum that serializes as 1/0, not true/false
        const lookup = Object.fromEntries(profiles.map((p) => [p.Name?.toLowerCase(), !!p.Enabled]))
        windowsProfiles.domain = lookup['domain'] ?? false
        windowsProfiles.private = lookup['private'] ?? false
        windowsProfiles.public = lookup['public'] ?? false
      } catch { /* ignore parse errors */ }
    }

    // Firewall is considered enabled if any third-party firewall is on OR all Windows profiles are on
    const thirdPartyEnabled = products.some((p) => p.enabled)
    const windowsEnabled = windowsProfiles.domain && windowsProfiles.private && windowsProfiles.public
    const enabled = thirdPartyEnabled || windowsEnabled

    return { enabled, products, windowsProfiles }
  }

  private async collectBitLockerStatus(): Promise<HealthReport['securityPosture']['bitlocker']> {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-BitLockerVolume | Select-Object MountPoint,VolumeStatus,ProtectionStatus | ConvertTo-Json -Compress',
      ], { timeout: 15_000, windowsHide: true })

      const raw = JSON.parse(stdout.trim())
      const vols: Array<{ MountPoint: string; VolumeStatus: number; ProtectionStatus: number }> =
        Array.isArray(raw) ? raw : [raw]

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

  private async collectScreenLockStatus(): Promise<HealthReport['securityPosture']['screenLock']> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      // Screensaver settings from HKCU + GPO inactivity lock from HKLM
      `$ss = Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name 'ScreenSaveActive','ScreenSaverIsSecure','ScreenSaveTimeOut' -ErrorAction SilentlyContinue; ` +
      `$gpo = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'InactivityTimeoutSecs' -ErrorAction SilentlyContinue; ` +
      `[PSCustomObject]@{ ` +
      `  ssActive = $ss.ScreenSaveActive; ` +
      `  ssSecure = $ss.ScreenSaverIsSecure; ` +
      `  ssTimeout = $ss.ScreenSaveTimeOut; ` +
      `  gpoTimeout = $gpo.InactivityTimeoutSecs ` +
      `} | ConvertTo-Json -Compress`,
    ], { timeout: 15_000, windowsHide: true })

    const data = JSON.parse(stdout.trim())
    const screenSaverEnabled = data.ssActive === '1' || data.ssActive === 1
    const lockOnResume = data.ssSecure === '1' || data.ssSecure === 1
    const timeoutSec = data.ssTimeout ? parseInt(String(data.ssTimeout), 10) : null
    const inactivityLockSec = typeof data.gpoTimeout === 'number' && data.gpoTimeout > 0 ? data.gpoTimeout : null

    return {
      screenSaverEnabled,
      lockOnResume,
      timeoutSec: timeoutSec && !isNaN(timeoutSec) ? timeoutSec : null,
      inactivityLockSec,
    }
  }

  private async collectPasswordPolicy(): Promise<HealthReport['securityPosture']['passwordPolicy']> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      // net accounts outputs localized text, so parse with regex on the numbers
      `$out = net accounts 2>&1; ` +
      `$lines = $out -split '\\r?\\n'; ` +
      `function val($pattern) { foreach ($l in $lines) { if ($l -match $pattern) { if ($l -match '(\\d+)') { return [int]$Matches[1] } } }; return 0 } ` +
      `$complexity = $false; ` +
      `try { $tmp = [System.IO.Path]::GetTempFileName(); ` +
      `  secedit /export /cfg $tmp /quiet 2>&1 | Out-Null; ` +
      `  $sec = Get-Content $tmp -Raw -ErrorAction SilentlyContinue; ` +
      `  Remove-Item $tmp -ErrorAction SilentlyContinue; ` +
      `  if ($sec -match 'PasswordComplexity\\s*=\\s*1') { $complexity = $true } ` +
      `} catch {} ` +
      `[PSCustomObject]@{ ` +
      `  minLength = val 'Minimum password length'; ` +
      `  maxAge = val 'Maximum password age'; ` +
      `  minAge = val 'Minimum password age'; ` +
      `  history = val 'password history'; ` +
      `  complexity = $complexity; ` +
      `  lockoutThreshold = val 'Lockout threshold'; ` +
      `  lockoutDuration = val 'Lockout duration'; ` +
      `  lockoutWindow = val 'Lockout observation' ` +
      `} | ConvertTo-Json -Compress`,
    ], { timeout: 15_000, windowsHide: true })

    const data = JSON.parse(stdout.trim())
    return {
      minLength: typeof data.minLength === 'number' ? data.minLength : 0,
      maxAgeDays: typeof data.maxAge === 'number' ? data.maxAge : 0,
      minAgeDays: typeof data.minAge === 'number' ? data.minAge : 0,
      historyCount: typeof data.history === 'number' ? data.history : 0,
      complexityRequired: data.complexity === true,
      lockoutThreshold: typeof data.lockoutThreshold === 'number' ? data.lockoutThreshold : 0,
      lockoutDurationMin: typeof data.lockoutDuration === 'number' ? data.lockoutDuration : 0,
      lockoutObservationMin: typeof data.lockoutWindow === 'number' ? data.lockoutWindow : 0,
    }
  }

  // ─── Command Execution ────────────────────────────────

  private async executeCommand(cmd: CloudCommand): Promise<void> {
    if (this.commandRunning) {
      if ('requestId' in cmd) {
        this.postCommandResult(cmd.requestId, false, undefined, 'Another command is already running').catch(() => {})
      }
      return
    }

    // Rate limit: minimum 5 seconds between commands to prevent resource exhaustion
    const elapsed = Date.now() - this.lastCommandFinishedAt
    if (elapsed < 5_000) {
      if ('requestId' in cmd) {
        this.postCommandResult(cmd.requestId, false, undefined, 'Rate limited — try again shortly').catch(() => {})
      }
      return
    }

    this.commandRunning = true
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      this.commandRunning = false
      if ('requestId' in cmd) {
        this.postCommandResult(cmd.requestId, false, undefined, 'Command timed out').catch(() => {})
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
          await this.postCommandResult(cmd.requestId, true, { sent: true })
          break
        // Power management
        case 'shutdown':
          await this.handleShutdown(cmd.requestId, cmd.delaySec)
          break
        case 'restart':
          await this.handleRestart(cmd.requestId, cmd.delaySec)
          break
        // Windows maintenance
        case 'windows-update-check':
          await this.handleWindowsUpdateCheck(cmd.requestId)
          break
        case 'windows-update-install':
          await this.handleWindowsUpdateInstall(cmd.requestId)
          break
        case 'run-sfc':
          await this.handleRunSfc(cmd.requestId)
          break
        case 'run-dism':
          await this.handleRunDism(cmd.requestId)
          break
        // Network
        case 'get-network-config':
          await this.handleGetNetworkConfig(cmd.requestId)
          break
        // Security
        case 'get-event-log':
          await this.handleGetEventLog(cmd.requestId, cmd.logName, cmd.maxEntries)
          break
        // App inventory
        case 'get-installed-apps':
          await this.handleGetInstalledApps(cmd.requestId)
          break
        // Phase 1: Fleet essentials
        case 'driver-update-scan':
          await this.handleDriverUpdateScan(cmd.requestId)
          break
        case 'driver-update-install':
          await this.handleDriverUpdateInstall(cmd.requestId, cmd.updateIds)
          break
        case 'driver-clean':
          await this.handleDriverClean(cmd.requestId, cmd.publishedNames)
          break
        case 'startup-list':
          await this.handleStartupList(cmd.requestId)
          break
        case 'startup-toggle':
          await this.handleStartupToggle(cmd.requestId, cmd.name, cmd.location, cmd.command, cmd.source, cmd.enabled)
          break
        case 'disk-health':
          await this.handleDiskHealth(cmd.requestId)
          break
        // Phase 2: Compliance & security
        case 'privacy-scan':
          await this.handlePrivacyScan(cmd.requestId)
          break
        case 'privacy-apply':
          await this.handlePrivacyApply(cmd.requestId, cmd.settingIds)
          break
        case 'debloater-scan':
          await this.handleDebloaterScan(cmd.requestId)
          break
        case 'debloater-remove':
          await this.handleDebloaterRemove(cmd.requestId, cmd.packageNames)
          break
        case 'service-scan':
          await this.handleServiceScan(cmd.requestId)
          break
        case 'service-apply':
          await this.handleServiceApply(cmd.requestId, cmd.changes)
          break
        // Phase 3: Maintenance
        case 'malware-quarantine':
          await this.handleMalwareQuarantine(cmd.requestId, cmd.paths)
          break
        case 'malware-delete':
          await this.handleMalwareDelete(cmd.requestId, cmd.paths)
          break
        case 'registry-scan':
          await this.handleRegistryScan(cmd.requestId)
          break
        case 'registry-fix':
          await this.handleRegistryFix(cmd.requestId, cmd.entryIds)
          break
      }
    } catch (err) {
      if (!timedOut) {
        const raw = err instanceof Error ? err.message : String(err)
        const msg = raw.length > 200 ? raw.slice(0, 200) : raw
        if ('requestId' in cmd) {
          this.postCommandResult(cmd.requestId, false, undefined, msg).catch(() => {})
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

  // ─── Command Handlers ────────────────────────────────

  private async handleScan(requestId: string, scanType: AllowedScanType): Promise<void> {
    const validScanTypes = new Set<string>([
      'system', 'browser', 'app', 'gaming', 'registry',
      'malware', 'network', 'recycle-bin', 'uninstall-leftovers',
    ])
    if (typeof scanType !== 'string' || !validScanTypes.has(scanType)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid scan type')
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
        await this.postCommandResult(requestId, true, {
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
        await this.postCommandResult(requestId, true, {
          scanType,
          entries: entries.map((e) => ({ id: e.id, type: e.type, risk: e.risk })),
          totalIssues: entries.length,
        })
        return
      }

      case 'malware': {
        const result = await scanMalware()
        // Strip full file paths — only send filename, detection info, and severity
        await this.postCommandResult(requestId, true, {
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
        await this.postCommandResult(requestId, true, {
          scanType,
          items: items.map((i) => ({ id: i.id, type: i.type })),
          totalItems: items.length,
        })
        return
      }

      default:
        await this.postCommandResult(requestId, false, undefined, 'Scan type not yet supported via cloud')
        return
    }
  }

  private async handleClean(requestId: string, itemIds: string[]): Promise<void> {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 1000) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid itemIds')
      return
    }
    if (itemIds.some((id) => typeof id !== 'string' || id.length > 200)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid itemIds')
      return
    }
    const result = await cleanItems(itemIds)
    // Strip local file paths from error details before sending to cloud
    await this.postCommandResult(requestId, true, {
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
    await this.postCommandResult(requestId, true, {
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
      await this.postCommandResult(requestId, false, undefined, 'Invalid appIds')
      return
    }
    if (appIds.some((id) => typeof id !== 'string' || id.length > 200)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid appIds')
      return
    }
    const result = await runUpdates(appIds, () => {})
    // Strip raw error reasons which may contain local paths or system info
    await this.postCommandResult(requestId, true, {
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

    await this.postCommandResult(requestId, true, {
      cpu: load.currentLoad,
      memoryPercent: (mem.active / mem.total) * 100,
      memoryUsedBytes: mem.active,
      memoryTotalBytes: mem.total,
      diskReadBps: diskIO?.rIO_sec ?? 0,
      diskWriteBps: diskIO?.wIO_sec ?? 0,
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

    await this.postCommandResult(requestId, true, {
      cpu: { model: `${cpu.manufacturer} ${cpu.brand}`, cores: cpu.physicalCores, threads: cpu.cores },
      os: { distro: osInfo.distro, release: osInfo.release, hostname: osInfo.hostname },
      memory: { total: mem.total, available: mem.available },
      disks: disks.map((d) => ({ name: d.name, size: d.size, type: d.type })),
    })
  }

  // ─── Power Management ────────────────────────────────

  private async handleShutdown(requestId: string, delaySec?: number): Promise<void> {
    const delay = Math.max(0, Math.min(typeof delaySec === 'number' ? delaySec : 30, 3600))
    cloudLog('INFO', `Shutdown requested with ${delay}s delay`)
    // Acknowledge before shutting down
    await this.postCommandResult(requestId, true, { action: 'shutdown', delaySec: delay })
    await execFileAsync('shutdown.exe', ['/s', '/t', String(delay)], { windowsHide: true })
  }

  private async handleRestart(requestId: string, delaySec?: number): Promise<void> {
    const delay = Math.max(0, Math.min(typeof delaySec === 'number' ? delaySec : 30, 3600))
    cloudLog('INFO', `Restart requested with ${delay}s delay`)
    await this.postCommandResult(requestId, true, { action: 'restart', delaySec: delay })
    await execFileAsync('shutdown.exe', ['/r', '/t', String(delay)], { windowsHide: true })
  }

  // ─── Windows Update ──────────────────────────────────

  private async handleWindowsUpdateCheck(requestId: string): Promise<void> {
    // Use PowerShell's WindowsUpdate module via COM object (works without PSWindowsUpdate module)
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$session = New-Object -ComObject Microsoft.Update.Session; ` +
      `$searcher = $session.CreateUpdateSearcher(); ` +
      `$result = $searcher.Search('IsInstalled=0'); ` +
      `$result.Updates | ForEach-Object { ` +
      `  [PSCustomObject]@{ Title=$_.Title; KBArticleIDs=($_.KBArticleIDs -join ','); ` +
      `  Severity=$_.MsrcSeverity; Size=$_.MaxDownloadSize; IsDownloaded=$_.IsDownloaded } ` +
      `} | ConvertTo-Json -Compress`,
    ], { timeout: 120_000, windowsHide: true })

    const trimmed = stdout.trim()
    if (!trimmed || trimmed === '') {
      await this.postCommandResult(requestId, true, { updates: [], totalCount: 0 })
      return
    }
    const raw = JSON.parse(trimmed)
    const updates: Array<{ Title: string; KBArticleIDs: string; Severity: string; Size: number; IsDownloaded: boolean }> =
      Array.isArray(raw) ? raw : [raw]

    await this.postCommandResult(requestId, true, {
      updates: updates.map((u) => ({
        title: u.Title ?? '',
        kb: u.KBArticleIDs ?? '',
        severity: u.Severity ?? 'Unspecified',
        sizeBytes: u.Size ?? 0,
        downloaded: u.IsDownloaded === true,
      })),
      totalCount: updates.length,
    })
  }

  private async handleWindowsUpdateInstall(requestId: string): Promise<void> {
    // Download and install all pending updates via COM
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$session = New-Object -ComObject Microsoft.Update.Session; ` +
      `$searcher = $session.CreateUpdateSearcher(); ` +
      `$result = $searcher.Search('IsInstalled=0'); ` +
      `if ($result.Updates.Count -eq 0) { Write-Output '{"installed":0,"needsReboot":false}'; exit } ` +
      `$downloader = $session.CreateUpdateDownloader(); ` +
      `$downloader.Updates = $result.Updates; ` +
      `$downloader.Download() | Out-Null; ` +
      `$installer = $session.CreateUpdateInstaller(); ` +
      `$installer.Updates = $result.Updates; ` +
      `$installResult = $installer.Install(); ` +
      `[PSCustomObject]@{ installed=$result.Updates.Count; ` +
      `resultCode=$installResult.ResultCode; ` +
      `needsReboot=$installResult.RebootRequired } | ConvertTo-Json -Compress`,
    ], { timeout: 300_000, windowsHide: true }) // 5 min timeout for installs

    const data = JSON.parse(stdout.trim())
    await this.postCommandResult(requestId, true, {
      installed: data.installed ?? 0,
      resultCode: data.resultCode ?? -1,
      needsReboot: data.needsReboot === true,
    })
  }

  // ─── System File Checker & DISM ──────────────────────

  private async handleRunSfc(requestId: string): Promise<void> {
    cloudLog('INFO', 'Running sfc /scannow')
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Start-Process -FilePath 'sfc.exe' -ArgumentList '/scannow' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$env:TEMP\\sfc_out.txt"; ` +
      `$output = Get-Content "$env:TEMP\\sfc_out.txt" -Raw -ErrorAction SilentlyContinue; ` +
      `Remove-Item "$env:TEMP\\sfc_out.txt" -ErrorAction SilentlyContinue; ` +
      `[PSCustomObject]@{ exitCode=$p.ExitCode; output=$output } | ConvertTo-Json -Compress`,
    ], { timeout: 300_000, windowsHide: true })

    const data = JSON.parse(stdout.trim())
    // Parse the SFC output for a summary line
    const output = (data.output ?? '') as string
    let status = 'unknown'
    if (output.includes('did not find any integrity violations')) status = 'clean'
    else if (output.includes('successfully repaired')) status = 'repaired'
    else if (output.includes('found corrupt files but was unable')) status = 'corrupt_unrepairable'
    else if (output.includes('could not perform')) status = 'failed'

    await this.postCommandResult(requestId, true, {
      exitCode: data.exitCode ?? -1,
      status,
    })
  }

  private async handleRunDism(requestId: string): Promise<void> {
    cloudLog('INFO', 'Running DISM /RestoreHealth')
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Start-Process -FilePath 'dism.exe' -ArgumentList '/Online','/Cleanup-Image','/RestoreHealth' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$env:TEMP\\dism_out.txt"; ` +
      `$output = Get-Content "$env:TEMP\\dism_out.txt" -Raw -ErrorAction SilentlyContinue; ` +
      `Remove-Item "$env:TEMP\\dism_out.txt" -ErrorAction SilentlyContinue; ` +
      `[PSCustomObject]@{ exitCode=$p.ExitCode; output=$output } | ConvertTo-Json -Compress`,
    ], { timeout: 300_000, windowsHide: true })

    const data = JSON.parse(stdout.trim())
    const output = (data.output ?? '') as string
    let status = 'unknown'
    if (output.includes('The restore operation completed successfully')) status = 'success'
    else if (output.includes('component store corruption')) status = 'corrupt'
    else if (output.includes('No component store corruption detected')) status = 'clean'
    else if (data.exitCode === 0) status = 'success'

    await this.postCommandResult(requestId, true, {
      exitCode: data.exitCode ?? -1,
      status,
    })
  }

  // ─── Network Config ──────────────────────────────────

  private async handleGetNetworkConfig(requestId: string): Promise<void> {
    const [interfaces, defaultGw, dns] = await Promise.all([
      si.networkInterfaces(),
      si.networkGatewayDefault(),
      execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,ServerAddresses | ConvertTo-Json -Compress',
      ], { timeout: 15_000, windowsHide: true }).catch(() => ({ stdout: '[]' })),
    ])

    let dnsServers: Array<{ iface: string; servers: string[] }> = []
    try {
      const raw = JSON.parse(dns.stdout.trim())
      const items: Array<{ InterfaceAlias: string; ServerAddresses: string[] }> =
        Array.isArray(raw) ? raw : [raw]
      dnsServers = items
        .filter((d) => d.ServerAddresses?.length > 0)
        .map((d) => ({ iface: d.InterfaceAlias, servers: d.ServerAddresses }))
    } catch { /* ignore */ }

    const ifaces = (Array.isArray(interfaces) ? interfaces : [interfaces])
      .filter((i) => i.ip4 || i.ip6)
      .map((i) => ({
        name: i.iface,
        type: i.type,
        ip4: i.ip4 || null,
        ip4subnet: i.ip4subnet || null,
        ip6: i.ip6 || null,
        mac: i.mac,
        speed: i.speed,
        operstate: i.operstate,
        dhcp: i.dhcp,
      }))

    await this.postCommandResult(requestId, true, {
      interfaces: ifaces,
      defaultGateway: defaultGw,
      dns: dnsServers,
    })
  }

  // ─── Event Log ───────────────────────────────────────

  private async handleGetEventLog(requestId: string, logName?: string, maxEntries?: number): Promise<void> {
    const allowedLogs = new Set(['System', 'Application', 'Security'])
    const log = allowedLogs.has(logName ?? '') ? logName! : 'System'
    const max = Math.max(1, Math.min(typeof maxEntries === 'number' ? maxEntries : 50, 200))

    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-WinEvent -LogName '${log}' -MaxEvents ${max} | ` +
      `Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message | ` +
      `ForEach-Object { [PSCustomObject]@{ ` +
      `time=$_.TimeCreated.ToString('o'); id=$_.Id; level=$_.LevelDisplayName; ` +
      `provider=$_.ProviderName; message=($_.Message -replace '\\r?\\n',' ').Substring(0, [Math]::Min(200, $_.Message.Length)) } } | ` +
      `ConvertTo-Json -Compress`,
    ], { timeout: 30_000, windowsHide: true })

    const raw = JSON.parse(stdout.trim())
    const entries: Array<{ time: string; id: number; level: string; provider: string; message: string }> =
      Array.isArray(raw) ? raw : [raw]

    await this.postCommandResult(requestId, true, {
      logName: log,
      entries: entries.map((e) => ({
        time: e.time,
        eventId: e.id,
        level: e.level ?? 'Information',
        provider: e.provider ?? '',
        message: e.message ?? '',
      })),
      totalReturned: entries.length,
    })
  }

  // ─── Installed Apps Inventory ────────────────────────

  // Registry scan session cache for fix operations
  private registryScanCache: Map<string, import('../../shared/types').RegistryEntry> = new Map()

  private async handleGetInstalledApps(requestId: string): Promise<void> {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      // Query both 64-bit and 32-bit uninstall registry keys
      `$apps = @(); ` +
      `$paths = @('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', ` +
      `'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); ` +
      `foreach ($p in $paths) { ` +
      `  $apps += Get-ItemProperty $p -ErrorAction SilentlyContinue | ` +
      `  Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' } | ` +
      `  Select-Object DisplayName,DisplayVersion,Publisher,InstallDate,EstimatedSize } ` +
      `$apps | Sort-Object DisplayName -Unique | ConvertTo-Json -Compress`,
    ], { timeout: 30_000, windowsHide: true })

    const trimmed = stdout.trim()
    if (!trimmed || trimmed === '') {
      await this.postCommandResult(requestId, true, { apps: [], totalCount: 0 })
      return
    }
    const raw = JSON.parse(trimmed)
    const apps: Array<{ DisplayName: string; DisplayVersion: string; Publisher: string; InstallDate: string; EstimatedSize: number }> =
      Array.isArray(raw) ? raw : [raw]

    await this.postCommandResult(requestId, true, {
      apps: apps.map((a) => ({
        name: a.DisplayName ?? '',
        version: a.DisplayVersion ?? '',
        publisher: a.Publisher ?? '',
        installDate: a.InstallDate ?? '',
        sizeKb: a.EstimatedSize ?? 0,
      })),
      totalCount: apps.length,
    })
  }
  // ─── Phase 1: Fleet Essentials ──────────────────────

  private async handleDriverUpdateScan(requestId: string): Promise<void> {
    cloudLog('INFO', 'Driver update scan requested')
    const result = await scanDriverUpdates()
    await this.postCommandResult(requestId, true, {
      updates: result.updates.map((u) => ({
        id: u.id,
        updateId: u.updateId,
        deviceName: u.deviceName,
        className: u.className,
        currentVersion: u.currentVersion,
        availableVersion: u.availableVersion,
        provider: u.provider,
        downloadSize: u.downloadSize,
      })),
      totalAvailable: result.totalAvailable,
    })
  }

  private async handleDriverUpdateInstall(requestId: string, updateIds: string[]): Promise<void> {
    if (!Array.isArray(updateIds) || updateIds.length === 0 || updateIds.length > 50) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid updateIds')
      return
    }
    if (updateIds.some((id) => typeof id !== 'string' || id.length > 200)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid updateIds')
      return
    }
    cloudLog('INFO', `Installing ${updateIds.length} driver updates`)
    const result = await installDriverUpdates(updateIds)
    await this.postCommandResult(requestId, true, {
      installed: result.installed,
      failed: result.failed,
      rebootRequired: result.rebootRequired,
      errors: result.errors.map((e) => ({ deviceName: e.deviceName, reason: e.reason.slice(0, 200) })),
    })
  }

  private async handleDriverClean(requestId: string, publishedNames: string[]): Promise<void> {
    if (!Array.isArray(publishedNames) || publishedNames.length === 0 || publishedNames.length > 100) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid publishedNames')
      return
    }
    if (publishedNames.some((n) => typeof n !== 'string' || !/^oem\d+\.inf$/i.test(n))) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid driver package names')
      return
    }
    cloudLog('INFO', `Cleaning ${publishedNames.length} obsolete drivers`)
    const result = await cleanDrivers(publishedNames)
    await this.postCommandResult(requestId, true, {
      removed: result.removed,
      failed: result.failed,
      spaceRecovered: result.spaceRecovered,
      errors: result.errors.map((e) => ({ publishedName: e.publishedName, reason: e.reason.slice(0, 200) })),
    })
  }

  private async handleStartupList(requestId: string): Promise<void> {
    const items = await listStartupItems()
    await this.postCommandResult(requestId, true, {
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        displayName: i.displayName,
        command: i.command,
        location: i.location,
        source: i.source,
        enabled: i.enabled,
        publisher: i.publisher,
        impact: i.impact,
      })),
      totalCount: items.length,
      enabledCount: items.filter((i) => i.enabled).length,
    })
  }

  private async handleStartupToggle(
    requestId: string, name: string, location: string, command: string, source: string, enabled: boolean
  ): Promise<void> {
    if (typeof name !== 'string' || typeof location !== 'string' || typeof command !== 'string' || typeof source !== 'string') {
      await this.postCommandResult(requestId, false, undefined, 'Invalid parameters')
      return
    }
    const validSources = new Set(['registry-hkcu', 'registry-hklm', 'startup-folder', 'task-scheduler'])
    if (!validSources.has(source)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid source')
      return
    }
    cloudLog('INFO', `Startup toggle: ${name} → ${enabled ? 'enabled' : 'disabled'}`)
    const success = await toggleStartupItem(name, location, command, source as any, enabled)
    await this.postCommandResult(requestId, success, { name, enabled }, success ? undefined : 'Failed to toggle startup item')
  }

  private async handleDiskHealth(requestId: string): Promise<void> {
    const perfService = new PerfMonitorService()
    const health = await perfService.getDiskHealth()
    await this.postCommandResult(requestId, true, {
      disks: health.map((d) => ({
        device: d.device,
        name: d.name,
        type: d.type,
        size: d.size,
        healthStatus: d.healthStatus,
        temperature: d.temperature,
        powerOnHours: d.powerOnHours,
        powerCycles: d.powerCycles,
        wearLevel: d.wearLevel,
      })),
    })
  }

  // ─── Phase 2: Compliance & Security ────────────────

  private async handlePrivacyScan(requestId: string): Promise<void> {
    cloudLog('INFO', 'Privacy scan requested')
    const result = await scanPrivacy()
    await this.postCommandResult(requestId, true, {
      settings: result.settings.map((s) => ({
        id: s.id,
        category: s.category,
        label: s.label,
        description: s.description,
        enabled: s.enabled,
        requiresAdmin: s.requiresAdmin,
      })),
      score: result.score,
      total: result.total,
      protected: result.protected,
    })
  }

  private async handlePrivacyApply(requestId: string, settingIds: string[]): Promise<void> {
    if (!Array.isArray(settingIds) || settingIds.length === 0 || settingIds.length > 50) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid settingIds')
      return
    }
    if (settingIds.some((id) => typeof id !== 'string' || id.length > 100)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid settingIds')
      return
    }
    cloudLog('INFO', `Applying ${settingIds.length} privacy settings`)
    const result = await applyPrivacySettings(settingIds)
    await this.postCommandResult(requestId, true, {
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((e) => ({ id: e.id, label: e.label, reason: e.reason.slice(0, 200) })),
    })
  }

  private async handleDebloaterScan(requestId: string): Promise<void> {
    cloudLog('INFO', 'Debloater scan requested')
    const apps = await scanBloatware()
    await this.postCommandResult(requestId, true, {
      apps: apps.map((a) => ({
        name: a.name,
        packageName: a.packageName,
        publisher: a.publisher,
        category: a.category,
        description: a.description,
        size: a.size,
      })),
      totalCount: apps.length,
    })
  }

  private async handleDebloaterRemove(requestId: string, packageNames: string[]): Promise<void> {
    if (!Array.isArray(packageNames) || packageNames.length === 0 || packageNames.length > 50) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid packageNames')
      return
    }
    if (packageNames.some((n) => typeof n !== 'string' || n.length > 200)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid packageNames')
      return
    }
    cloudLog('INFO', `Removing ${packageNames.length} bloatware packages`)
    const result = await removeBloatware(packageNames)
    await this.postCommandResult(requestId, true, {
      removed: result.removed,
      failed: result.failed,
    })
  }

  private async handleServiceScan(requestId: string): Promise<void> {
    cloudLog('INFO', 'Service scan requested')
    const result = await scanServices()
    await this.postCommandResult(requestId, true, {
      services: result.services.map((s) => ({
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        status: s.status,
        startType: s.startType,
        safety: s.safety,
        category: s.category,
        isMicrosoft: s.isMicrosoft,
      })),
      totalCount: result.totalCount,
      runningCount: result.runningCount,
      disabledCount: result.disabledCount,
      safeToDisableCount: result.safeToDisableCount,
    })
  }

  private async handleServiceApply(requestId: string, changes: Array<{ name: string; targetStartType: string }>): Promise<void> {
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > 50) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid changes')
      return
    }
    const validStartTypes = new Set(['Disabled', 'Manual'])
    if (changes.some((c) => typeof c.name !== 'string' || !validStartTypes.has(c.targetStartType))) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid changes — targetStartType must be Disabled or Manual')
      return
    }
    cloudLog('INFO', `Applying ${changes.length} service changes`)
    const result = await applyServiceChanges(changes)
    await this.postCommandResult(requestId, true, {
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((e) => ({ name: e.name, displayName: e.displayName, reason: e.reason.slice(0, 200) })),
    })
  }

  // ─── Phase 3: Maintenance ─────────────────────────

  private async handleMalwareQuarantine(requestId: string, paths: string[]): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid paths')
      return
    }
    if (paths.some((p) => typeof p !== 'string' || p.length > 500)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid paths')
      return
    }
    cloudLog('INFO', `Quarantining ${paths.length} files`)
    const result = await quarantineMalware(paths)
    await this.postCommandResult(requestId, true, {
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((e) => ({ path: e.path, reason: e.reason.slice(0, 200) })),
    })
  }

  private async handleMalwareDelete(requestId: string, paths: string[]): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid paths')
      return
    }
    if (paths.some((p) => typeof p !== 'string' || p.length > 500)) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid paths')
      return
    }
    cloudLog('INFO', `Deleting ${paths.length} malware files`)
    const result = await deleteMalware(paths)
    await this.postCommandResult(requestId, true, {
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors.map((e) => ({ path: e.path, reason: e.reason.slice(0, 200) })),
    })
  }

  private async handleRegistryScan(requestId: string): Promise<void> {
    cloudLog('INFO', 'Registry scan requested')
    const entries = await scanRegistry()
    // Cache entries for subsequent fix operation
    this.registryScanCache.clear()
    for (const e of entries) this.registryScanCache.set(e.id, e)

    await this.postCommandResult(requestId, true, {
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        keyPath: e.keyPath,
        valueName: e.valueName,
        issue: e.issue,
        risk: e.risk,
      })),
      totalCount: entries.length,
      byType: entries.reduce<Record<string, number>>((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc }, {}),
      byRisk: entries.reduce<Record<string, number>>((acc, e) => { acc[e.risk] = (acc[e.risk] || 0) + 1; return acc }, {}),
    })
  }

  private async handleRegistryFix(requestId: string, entryIds: string[]): Promise<void> {
    if (!Array.isArray(entryIds) || entryIds.length === 0 || entryIds.length > 500) {
      await this.postCommandResult(requestId, false, undefined, 'Invalid entryIds')
      return
    }
    // Resolve IDs from cache
    const entriesToFix = entryIds
      .map((id) => this.registryScanCache.get(id))
      .filter((e): e is import('../../shared/types').RegistryEntry => !!e)

    if (entriesToFix.length === 0) {
      await this.postCommandResult(requestId, false, undefined, 'No matching entries found — run registry-scan first')
      return
    }
    cloudLog('INFO', `Fixing ${entriesToFix.length} registry entries`)
    const result = await fixRegistryEntries(entriesToFix)
    await this.postCommandResult(requestId, true, {
      fixed: result.fixed,
      failed: result.failed,
      failures: result.failures.map((f) => ({ issue: f.issue.slice(0, 200), reason: f.reason.slice(0, 200) })),
    })
  }
}

export const cloudAgent = new CloudAgentService()
