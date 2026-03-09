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
    return service.killProcess(pid)
  })

  ipcMain.handle(IPC.PERF_DISK_HEALTH, () => service.getDiskHealth())
}
