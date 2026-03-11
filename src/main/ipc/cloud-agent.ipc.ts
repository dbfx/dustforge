import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { cloudAgent } from '../services/cloud-agent'

export function registerCloudAgentIpc(): void {
  ipcMain.handle(IPC.CLOUD_LINK, async (_event, apiKey: string) => {
    if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 200) {
      return { success: false, error: 'Invalid API key' }
    }
    return cloudAgent.link(apiKey)
  })

  ipcMain.handle(IPC.CLOUD_UNLINK, async () => {
    return cloudAgent.unlink()
  })

  ipcMain.handle(IPC.CLOUD_GET_STATUS, () => {
    return cloudAgent.getStatus()
  })

  ipcMain.handle(IPC.CLOUD_RECONNECT, async () => {
    return cloudAgent.reconnect()
  })
}
