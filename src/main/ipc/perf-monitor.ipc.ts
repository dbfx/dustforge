import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { PerfMonitorService } from '../services/perf-monitor'

export function registerPerfMonitorIpc(): void {
  const service = new PerfMonitorService()

  ipcMain.handle(IPC.PERF_GET_SYSTEM_INFO, () => service.getSystemInfo())

  ipcMain.handle(IPC.PERF_START_MONITORING, (event) => {
    return service.startMonitoring(event.sender)
  })

  ipcMain.handle(IPC.PERF_STOP_MONITORING, () => {
    service.stopMonitoring()
  })

  ipcMain.handle(IPC.PERF_KILL_PROCESS, (_event, pid: number) => {
    // Validate pid is a positive integer and not a critical system process
    if (!Number.isInteger(pid) || pid <= 0) {
      return { success: false, error: 'Invalid process ID' }
    }
    // Block PID 0 (System Idle / kernel), PID 1 (init/launchd), PID 4 (Windows System)
    if (pid <= 4) {
      return { success: false, error: 'Cannot kill critical system process' }
    }
    // Prevent the app from killing itself
    if (pid === process.pid) {
      return { success: false, error: 'Cannot kill own process' }
    }
    return service.killProcess(pid)
  })

  ipcMain.handle(IPC.PERF_DISK_HEALTH, () => service.getDiskHealth())
}
