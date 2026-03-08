import * as si from 'systeminformation'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/channels'
import type {
  PerfSystemInfo,
  PerfSnapshot,
  PerfProcess,
  PerfProcessList,
  PerfKillResult,
  StartupItem
} from '../../shared/types'

const execFileAsync = promisify(execFile)

export class PerfMonitorService {
  private fastTimer: ReturnType<typeof setInterval> | null = null
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private sender: Electron.WebContents | null = null
  private cachedSystemInfo: PerfSystemInfo | null = null
  private startupExeMap: Map<string, string> = new Map()

  async getSystemInfo(): Promise<PerfSystemInfo> {
    if (this.cachedSystemInfo) return this.cachedSystemInfo

    const [cpu, os, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()])

    this.cachedSystemInfo = {
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
      cpuCores: cpu.physicalCores,
      cpuThreads: cpu.cores,
      totalMemBytes: mem.total,
      osVersion: `${os.distro} ${os.release}`,
      hostname: os.hostname
    }
    return this.cachedSystemInfo
  }

  async startMonitoring(
    sender: Electron.WebContents,
    getStartupItems?: () => Promise<StartupItem[]>
  ): Promise<void> {
    // If already running, just update the sender
    if (this.fastTimer) {
      this.sender = sender
      return
    }

    this.sender = sender

    // Build startup exe map for correlation
    if (getStartupItems) {
      try {
        const items = await getStartupItems()
        this.startupExeMap.clear()
        for (const item of items) {
          // Extract exe name from command string
          const match = item.command.match(/([^/\\]+\.exe)/i)
          if (match) {
            this.startupExeMap.set(match[1].toLowerCase(), item.displayName || item.name)
          }
        }
      } catch {
        // Startup correlation is optional
      }
    }

    // Fast interval: system metrics every 1s
    this.fastTimer = setInterval(() => this.collectSnapshot(), 1000)
    // Collect immediately
    this.collectSnapshot()

    // Slow interval: process list every 3s
    this.slowTimer = setInterval(() => this.collectProcesses(), 3000)
    this.collectProcesses()
  }

  stopMonitoring(): void {
    if (this.fastTimer) {
      clearInterval(this.fastTimer)
      this.fastTimer = null
    }
    if (this.slowTimer) {
      clearInterval(this.slowTimer)
      this.slowTimer = null
    }
    this.sender = null
  }

  async killProcess(pid: number): Promise<PerfKillResult> {
    try {
      process.kill(pid)
      return { success: true }
    } catch {
      // Fallback to taskkill
      try {
        await execFileAsync('taskkill', ['/F', '/PID', String(pid)])
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const requiresAdmin = message.includes('Access') || message.includes('denied')
        return {
          success: false,
          error: requiresAdmin
            ? 'Access denied. Run DustForge as Administrator to end this process.'
            : `Failed to end process: ${message}`,
          requiresAdmin
        }
      }
    }
  }

  private async collectSnapshot(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }

    try {
      const [load, mem, disk, net] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.disksIO(),
        si.networkStats()
      ])

      const snapshot: PerfSnapshot = {
        timestamp: Date.now(),
        cpu: {
          overall: load.currentLoad,
          perCore: load.cpus.map((c) => c.load)
        },
        memory: {
          usedBytes: mem.active,
          totalBytes: mem.total,
          cachedBytes: mem.cached,
          percent: (mem.active / mem.total) * 100
        },
        disk: {
          readBytesPerSec: disk?.rIO_sec ?? 0,
          writeBytesPerSec: disk?.wIO_sec ?? 0
        },
        network: {
          rxBytesPerSec: net.reduce((sum, n) => sum + n.rx_sec, 0),
          txBytesPerSec: net.reduce((sum, n) => sum + n.tx_sec, 0)
        },
        uptime: si.time().uptime
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_SNAPSHOT, snapshot)
      }
    } catch {
      // Silently skip failed ticks
    }
  }

  private async collectProcesses(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }

    try {
      const data = await si.processes()

      // Sort by CPU + memory and take top 100
      const sorted = data.list
        .sort((a, b) => b.cpu + b.memRss - (a.cpu + a.memRss))
        .slice(0, 100)

      const processes: PerfProcess[] = sorted.map((p) => {
        const exeName = (p.name || '').toLowerCase()
        const startupName = this.startupExeMap.get(
          exeName.endsWith('.exe') ? exeName : `${exeName}.exe`
        )

        return {
          pid: p.pid,
          name: p.name,
          cpuPercent: p.cpu,
          memBytes: p.memRss,
          memPercent: p.memVsz > 0 ? (p.memRss / p.memVsz) * 100 : 0,
          user: p.user || '',
          started: p.started || '',
          isStartupItem: !!startupName,
          startupItemName: startupName
        }
      })

      const result: PerfProcessList = {
        timestamp: Date.now(),
        processes,
        totalCount: data.all
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_PROCESS_LIST, result)
      }
    } catch {
      // Silently skip failed ticks
    }
  }
}
