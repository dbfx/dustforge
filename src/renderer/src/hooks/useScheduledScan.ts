import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useScanStore } from '@/stores/scan-store'
import { ScanStatus } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import { formatBytes, formatNumber } from '@/lib/utils'

/**
 * Hook that listens for scheduled scan triggers from the main process
 * and automatically runs a full scan when triggered.
 */
export function useScheduledScan(): void {
  const scanningRef = useRef(false)

  useEffect(() => {
    if (!window.dustforge?.onScheduledScanTrigger) return undefined

    const unsubscribe = window.dustforge.onScheduledScanTrigger(async () => {
      // Prevent overlapping scans
      if (scanningRef.current) return
      const store = useScanStore.getState()
      if (store.status === ScanStatus.Scanning || store.status === ScanStatus.Cleaning) return

      scanningRef.current = true
      toast.info('Scheduled scan started', { description: 'Running automatic system scan...' })

      store.setStatus(ScanStatus.Scanning)
      store.setResults([])

      try {
        const scanFns: Array<{ label: string; fn: () => Promise<ScanResult[]> }> = [
          { label: 'System', fn: () => window.dustforge.systemScan() },
          { label: 'Browsers', fn: () => window.dustforge.browserScan() },
          { label: 'Applications', fn: () => window.dustforge.appScan() },
          { label: 'Gaming', fn: () => window.dustforge.gamingScan() },
          { label: 'Recycle Bin', fn: () => window.dustforge.recycleBinScan() }
        ]

        for (const scan of scanFns) {
          try {
            const results = await scan.fn()
            store.addResults(results)
          } catch {
            // Skip failed categories
          }
        }

        store.setStatus(ScanStatus.Complete)
        store.setProgress(null)

        // Calculate totals for notification
        const results = useScanStore.getState().results
        const totalSize = results.reduce((s, r) => s + r.totalSize, 0)
        const totalItems = results.reduce((s, r) => s + r.itemCount, 0)

        // Notify main process for system notification
        window.dustforge.notifyScheduledScanComplete?.(totalSize, totalItems)

        toast.success('Scheduled scan complete', {
          description: `Found ${formatNumber(totalItems)} items (${formatBytes(totalSize)}) that can be cleaned.`
        })
      } catch {
        store.setStatus(ScanStatus.Error)
        store.setProgress(null)
        toast.error('Scheduled scan failed', { description: 'An error occurred during the automatic scan.' })
      } finally {
        scanningRef.current = false
      }
    })

    return () => { unsubscribe() }
  }, [])
}
