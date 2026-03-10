// ─── Cloud Agent Protocol Types ─────────────────────────────

export type CloudAgentStatus = 'dormant' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface CloudAgentState {
  status: CloudAgentStatus
  maskedApiKey: string | null
  deviceId: string | null
  linkedAt: string | null
  lastTelemetryAt: string | null
  lastHealthReportAt: string | null
  lastCommandAt: string | null
  error: string | null
}

// ─── Commands (cloud → agent) ───────────────────────────────

export type AllowedScanType =
  | 'system'
  | 'browser'
  | 'app'
  | 'gaming'
  | 'registry'
  | 'malware'
  | 'network'
  | 'recycle-bin'
  | 'uninstall-leftovers'

export type CloudCommand =
  | { type: 'scan'; requestId: string; scanType: AllowedScanType }
  | { type: 'clean'; requestId: string; scanType: AllowedScanType; itemIds: string[] }
  | { type: 'software-update-check'; requestId: string }
  | { type: 'software-update-run'; requestId: string; appIds: string[] }
  | { type: 'get-status'; requestId: string }
  | { type: 'get-system-info'; requestId: string }
  | { type: 'get-health-report'; requestId: string }
  | { type: 'ping' }
  | { type: 'auth-ok' }
  | { type: 'auth-error'; error?: string }

// ─── Messages (agent → cloud) ───────────────────────────────

export type CloudMessage =
  | { type: 'auth'; apiKey: string; deviceId: string; appVersion: string; hostname: string }
  | { type: 'telemetry'; deviceId: string; timestamp: number; snapshot: TelemetrySnapshot }
  | { type: 'health-report'; deviceId: string; timestamp: number; report: HealthReport }
  | { type: 'command-result'; requestId: string; success: boolean; data?: unknown; error?: string }
  | { type: 'pong' }

// ─── Telemetry (frequent, lightweight) ──────────────────────

export interface TelemetrySnapshot {
  cpu: number
  memoryPercent: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  diskReadBps: number
  diskWriteBps: number
  networkRxBps: number
  networkTxBps: number
  uptime: number
  disks: Array<{
    fs: string
    size: number
    used: number
    available: number
    mount: string
  }>
  diskHealth?: Array<{
    device: string
    healthStatus: string
    temperature: number | null
  }>
  topProcesses?: Array<{
    name: string
    cpuPercent: number
    memPercent: number
  }>
}

// ─── Health Report (infrequent, comprehensive) ──────────────

export interface HealthReport {
  // Registry issues grouped by type
  registry: {
    totalIssues: number
    byType: Record<string, number>
    byRisk: Record<string, number>
  }

  // Software updates available
  softwareUpdates: {
    totalAvailable: number
    bySeverity: Record<string, number>
    apps: Array<{ id: string; name: string; current: string; available: string; severity: string }>
  }

  // Driver updates available
  driverUpdates: {
    totalAvailable: number
    drivers: Array<{ deviceName: string; className: string; currentVersion: string; availableVersion: string }>
  }

  // Services that could be optimized
  services: {
    totalRunning: number
    totalDisabled: number
    safeToDisable: number
    byCategory: Record<string, { total: number; running: number; safeToDisable: number }>
  }

  // Privacy score and breakdown
  privacy: {
    score: number
    total: number
    protected: number
    byCategory: Record<string, { total: number; protected: number }>
  }

  // Malware scan summary
  malware: {
    threatsFound: number
    filesScanned: number
    bySeverity: Record<string, number>
    threats: Array<{ fileName: string; detectionName: string; severity: string; source: string }>
  }

  // Security posture (native Windows checks)
  securityPosture: {
    antivirus: {
      enabled: boolean
      realTimeProtection: boolean
      signatureAge: number | null       // days since last signature update
      productName: string | null
    }
    firewall: {
      domain: boolean
      private: boolean
      public: boolean
    }
    bitlocker: {
      volumes: Array<{
        mount: string
        status: 'FullyEncrypted' | 'EncryptionInProgress' | 'DecryptionInProgress' | 'FullyDecrypted' | 'Unknown'
        protectionOn: boolean
      }>
    }
    windowsUpdate: {
      recentPatches: Array<{
        id: string
        installedOn: string
        description: string
      }>
      lastPatchDate: string | null       // ISO date of most recent patch
      daysSinceLastPatch: number | null
    }
  }
}
