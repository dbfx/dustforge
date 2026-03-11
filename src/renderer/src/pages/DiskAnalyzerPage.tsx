import { useEffect, useMemo, useState } from 'react'
import { HardDrive, ChevronRight, Folder, File, RefreshCw, FileType2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { cn, formatBytes } from '@/lib/utils'
import { useDiskStore } from '@/stores/disk-store'
import type { DiskNode, DriveInfo } from '@shared/types'

type ViewMode = 'folders' | 'filetypes'

const COLORS = ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#a16207', '#ca8a04', '#eab308', '#facc15', '#fbbf24']

interface TreemapRect { name: string; size: number; x: number; y: number; w: number; h: number; color: string }

function squarify(items: { name: string; size: number; fill: string }[], x: number, y: number, w: number, h: number, rects: TreemapRect[]) {
  if (!items.length || w <= 0 || h <= 0) return
  if (items.length === 1) {
    rects.push({ name: items[0].name, size: items[0].size, x, y, w, h, color: items[0].fill })
    return
  }
  const total = items.reduce((s, i) => s + i.size, 0)
  const horizontal = w >= h
  const side = horizontal ? h : w
  // Find the best row: add items until aspect ratio worsens
  let rowSum = 0
  let bestIdx = 0
  let bestWorst = Infinity
  for (let i = 0; i < items.length; i++) {
    rowSum += items[i].size
    const rowFrac = rowSum / total
    const rowLen = horizontal ? w * rowFrac : h * rowFrac
    // Compute worst aspect ratio in this row
    let worst = 0
    let sub = 0
    for (let j = 0; j <= i; j++) {
      sub += items[j].size
      const frac = items[j].size / rowSum
      const itemLen = side * frac
      const aspect = rowLen > itemLen ? rowLen / itemLen : itemLen / rowLen
      if (aspect > worst) worst = aspect
    }
    if (worst <= bestWorst) { bestWorst = worst; bestIdx = i }
    else break
  }
  const rowItems = items.slice(0, bestIdx + 1)
  const restItems = items.slice(bestIdx + 1)
  const rowTotal = rowItems.reduce((s, i) => s + i.size, 0)
  const rowFrac = rowTotal / total
  if (horizontal) {
    const rowW = w * rowFrac
    let cy = y
    for (const item of rowItems) {
      const itemH = h * (item.size / rowTotal)
      rects.push({ name: item.name, size: item.size, x, y: cy, w: rowW, h: itemH, color: item.fill })
      cy += itemH
    }
    squarify(restItems, x + rowW, y, w - rowW, h, rects)
  } else {
    const rowH = h * rowFrac
    let cx = x
    for (const item of rowItems) {
      const itemW = w * (item.size / rowTotal)
      rects.push({ name: item.name, size: item.size, x: cx, y, w: itemW, h: rowH, color: item.fill })
      cx += itemW
    }
    squarify(restItems, x, y + rowH, w, h - rowH, rects)
  }
}

function layoutTreemap(items: { name: string; size: number; fill: string }[], width: number, height: number): TreemapRect[] {
  if (!items.length || width <= 0 || height <= 0) return []
  const total = items.reduce((s, i) => s + i.size, 0)
  if (total <= 0) return []
  // Group tiny items (<1.5% each) into "Other"
  const threshold = total * 0.015
  const big = items.filter((i) => i.size >= threshold)
  const small = items.filter((i) => i.size < threshold)
  const grouped = [...big]
  if (small.length > 0) {
    const otherSize = small.reduce((s, i) => s + i.size, 0)
    grouped.push({ name: `${small.length} other items`, size: otherSize, fill: '#52525b' })
  }
  const sorted = grouped.sort((a, b) => b.size - a.size)
  const rects: TreemapRect[] = []
  squarify(sorted, 0, 0, width, height, rects)
  return rects
}

export function DiskAnalyzerPage() {
  const drives = useDiskStore((s) => s.drives)
  const selectedDrive = useDiskStore((s) => s.selectedDrive)
  const data = useDiskStore((s) => s.data)
  const analyzing = useDiskStore((s) => s.analyzing)
  const breadcrumb = useDiskStore((s) => s.breadcrumb)
  const error = useDiskStore((s) => s.error)
  const fileTypes = useDiskStore((s) => s.fileTypes)
  const fileTypesLoading = useDiskStore((s) => s.fileTypesLoading)
  const store = useDiskStore()
  const [viewMode, setViewMode] = useState<ViewMode>('folders')

  useEffect(() => {
    if (drives.length === 0) {
      window.dustforge?.diskDrives?.().then(store.setDrives).catch((err) => {
        console.error('Failed to load drives:', err)
      })
    }
  }, [])

  const handleAnalyze = async () => {
    store.setAnalyzing(true); store.setData(null); store.setBreadcrumb([]); store.setError(null); store.setFileTypes([])
    try {
      const result = await window.dustforge.diskAnalyze(selectedDrive)
      store.setData(result); store.setBreadcrumb([result])
    } catch (err) {
      console.error('Disk analysis failed:', err)
      toast.error(`Failed to analyze drive ${selectedDrive}:`, { description: 'Make sure the drive is accessible' })
      store.setError(`Failed to analyze drive ${selectedDrive}:. Make sure the drive is accessible.`)
    }
    store.setAnalyzing(false)
  }

  const handleFileTypeScan = async () => {
    store.setFileTypesLoading(true); store.setError(null)
    try {
      const result = await window.dustforge.diskFileTypes(selectedDrive)
      store.setFileTypes(result)
    } catch (err) {
      console.error('File type scan failed:', err)
      store.setError(`Failed to scan file types on ${selectedDrive}:.`)
    }
    store.setFileTypesLoading(false)
  }

  // Auto-scan file types when switching to that view if not already loaded
  useEffect(() => {
    if (viewMode === 'filetypes' && fileTypes.length === 0 && !fileTypesLoading && data) {
      handleFileTypeScan()
    }
  }, [viewMode])

  const currentNode = breadcrumb[breadcrumb.length - 1] ?? data
  const treemapData = useMemo(() => {
    if (!currentNode?.children) return []
    return [...currentNode.children].sort((a, b) => b.size - a.size).map((c, i) => ({ name: c.name, size: c.size, fill: COLORS[i % COLORS.length] }))
  }, [currentNode])

  const fileTypesTotal = useMemo(() => fileTypes.reduce((s, ft) => s + ft.totalSize, 0), [fileTypes])

  const drillDown = (node: DiskNode) => { if (node.children?.length) store.pushBreadcrumb(node) }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Disk Analyzer" description="Visualize disk space usage"
        action={
          <div className="flex items-center gap-2.5">
            <select value={selectedDrive} onChange={(e) => store.setSelectedDrive(e.target.value)}
              className="rounded-xl px-4 py-2.5 text-[13px] text-zinc-400 outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {(drives.length > 0 ? drives : [{ letter: 'C', label: 'System', totalSize: 0, freeSpace: 0, usedSpace: 0 }]).map((d) => (
                <option key={d.letter} value={d.letter}>{d.letter}: {d.label}</option>
              ))}
            </select>
            <button onClick={handleAnalyze} disabled={analyzing}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#1a0a00' }}>
              {analyzing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" strokeWidth={2} />}
              Analyze
            </button>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => store.setError(null)} className="mb-5" />}

      {analyzing && <ScanProgress status="scanning" progress={0} currentPath={`Analyzing ${selectedDrive}:\\...`} className="mb-5" />}
      {!data && !analyzing && !error && <EmptyState icon={HardDrive} title="No analysis data" description="Select a drive and click Analyze to visualize disk space usage." />}

      {data && (
        <>
          {/* View mode toggle */}
          <div className="mb-5 flex items-center gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', width: 'fit-content' }}>
            <button onClick={() => setViewMode('folders')}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all"
              style={{ background: viewMode === 'folders' ? 'rgba(245,158,11,0.15)' : 'transparent', color: viewMode === 'folders' ? '#f59e0b' : '#6e6e76' }}>
              <Folder className="h-3.5 w-3.5" strokeWidth={2} />
              Folders
            </button>
            <button onClick={() => setViewMode('filetypes')}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all"
              style={{ background: viewMode === 'filetypes' ? 'rgba(245,158,11,0.15)' : 'transparent', color: viewMode === 'filetypes' ? '#f59e0b' : '#6e6e76' }}>
              <FileType2 className="h-3.5 w-3.5" strokeWidth={2} />
              File Types
            </button>
          </div>

          {viewMode === 'folders' && currentNode && (
            <>
              {/* Breadcrumb */}
              <div className="mb-5 flex items-center gap-1">
                {breadcrumb.map((node, i) => (
                  <div key={node.path} className="flex items-center">
                    {i > 0 && <ChevronRight className="mx-1 h-3 w-3" style={{ color: '#3a3a42' }} />}
                    <button onClick={() => store.sliceBreadcrumb(i)}
                      className="rounded-md px-2 py-1 font-mono text-[12px] transition-colors"
                      style={{ color: i === breadcrumb.length - 1 ? '#f59e0b' : '#6e6e76' }}>
                      {node.name}
                    </button>
                  </div>
                ))}
              </div>

              {/* Treemap */}
              {treemapData.length > 0 && (
                <div className="mb-6 overflow-hidden rounded-2xl p-1.5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="relative h-[280px] w-full">
                    {layoutTreemap(treemapData, 100, 100).map((rect) => (
                      <div key={rect.name}
                        className="absolute overflow-hidden rounded-md p-2 opacity-75 transition-opacity hover:opacity-100 cursor-pointer"
                        style={{
                          left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`,
                          background: rect.color,
                          boxSizing: 'border-box',
                          border: '2px solid #0c0c0e',
                        }}>
                        {rect.w > 8 && rect.h > 12 && (
                          <span className="block truncate text-[12px] font-semibold text-white">{rect.name}</span>
                        )}
                        {rect.w > 12 && rect.h > 20 && (
                          <span className="block truncate text-[10px] text-white/80">{formatBytes(rect.size)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Folder table */}
              {currentNode.children && (
                <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-4 px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
                    style={{ background: '#14141a', color: '#4e4e56', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="flex-1">Name</div>
                    <div className="w-28 text-right">Size</div>
                    <div className="w-44">Usage</div>
                  </div>
                  <div>
                    {[...currentNode.children].sort((a, b) => b.size - a.size).map((child) => {
                      const percent = currentNode.size > 0 ? (child.size / currentNode.size) * 100 : 0
                      return (
                        <button key={child.path} onClick={() => drillDown(child)}
                          className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                          <div className="flex flex-1 items-center gap-2.5 min-w-0">
                            {child.children ? <Folder className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.8} /> : <File className="h-4 w-4 shrink-0" style={{ color: '#4e4e56' }} strokeWidth={1.8} />}
                            <span className="truncate text-[13px] text-zinc-300">{child.name}</span>
                          </div>
                          <span className="w-28 text-right font-mono text-[12px]" style={{ color: '#6e6e76' }}>{formatBytes(child.size)}</span>
                          <div className="w-44 flex items-center gap-2.5">
                            <div className="flex-1 h-[5px] rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                              <div className="h-full rounded-full" style={{ width: `${percent}%`, background: '#f59e0b' }} />
                            </div>
                            <span className="w-10 text-right font-mono text-[11px]" style={{ color: '#4e4e56' }}>{percent.toFixed(0)}%</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {viewMode === 'filetypes' && (
            <>
              {fileTypesLoading && <ScanProgress status="scanning" progress={0} currentPath={`Scanning file types on ${selectedDrive}:\\...`} className="mb-5" />}

              {!fileTypesLoading && fileTypes.length === 0 && (
                <EmptyState icon={FileType2} title="No file type data" description="Click Analyze first, then switch to File Types view to scan." />
              )}

              {!fileTypesLoading && fileTypes.length > 0 && (
                <>
                  {/* Summary cards */}
                  <div className="mb-5 grid grid-cols-3 gap-3">
                    <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#4e4e56' }}>Total Scanned</div>
                      <div className="mt-1 text-[18px] font-semibold text-zinc-200">{formatBytes(fileTypesTotal)}</div>
                    </div>
                    <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#4e4e56' }}>File Types</div>
                      <div className="mt-1 text-[18px] font-semibold text-zinc-200">{fileTypes.length}</div>
                    </div>
                    <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#4e4e56' }}>Largest Type</div>
                      <div className="mt-1 text-[18px] font-semibold text-zinc-200">{fileTypes[0]?.extension ?? '-'}</div>
                    </div>
                  </div>

                  {/* File type treemap */}
                  <div className="mb-6 overflow-hidden rounded-2xl p-1.5" style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="relative h-[280px] w-full">
                      {layoutTreemap(
                        fileTypes.slice(0, 30).map((ft, i) => ({ name: ft.extension, size: ft.totalSize, fill: COLORS[i % COLORS.length] })),
                        100, 100
                      ).map((rect) => (
                        <div key={rect.name}
                          className="absolute overflow-hidden rounded-md p-2 opacity-75 transition-opacity hover:opacity-100"
                          style={{
                            left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`,
                            background: rect.color,
                            boxSizing: 'border-box',
                            border: '2px solid #0c0c0e',
                          }}>
                          {rect.w > 6 && rect.h > 12 && (
                            <span className="block truncate text-[12px] font-semibold text-white">{rect.name}</span>
                          )}
                          {rect.w > 10 && rect.h > 20 && (
                            <span className="block truncate text-[10px] text-white/80">{formatBytes(rect.size)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* File type table */}
                  <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center gap-4 px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
                      style={{ background: '#14141a', color: '#4e4e56', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className="flex-1">Extension</div>
                      <div className="w-20 text-right">Files</div>
                      <div className="w-28 text-right">Size</div>
                      <div className="w-44">Share</div>
                    </div>
                    <div>
                      {fileTypes.map((ft, i) => {
                        const percent = fileTypesTotal > 0 ? (ft.totalSize / fileTypesTotal) * 100 : 0
                        return (
                          <div key={ft.extension}
                            className="flex w-full items-center gap-4 px-5 py-3 transition-colors"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                            <div className="flex flex-1 items-center gap-2.5 min-w-0">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded" style={{ background: COLORS[i % COLORS.length] + '22' }}>
                                <FileType2 className="h-3.5 w-3.5" style={{ color: COLORS[i % COLORS.length] }} strokeWidth={2} />
                              </div>
                              <span className="truncate font-mono text-[13px] text-zinc-300">{ft.extension}</span>
                            </div>
                            <span className="w-20 text-right font-mono text-[12px]" style={{ color: '#6e6e76' }}>{ft.fileCount.toLocaleString()}</span>
                            <span className="w-28 text-right font-mono text-[12px]" style={{ color: '#6e6e76' }}>{formatBytes(ft.totalSize)}</span>
                            <div className="w-44 flex items-center gap-2.5">
                              <div className="flex-1 h-[5px] rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.max(percent, 0.5)}%`, background: COLORS[i % COLORS.length] }} />
                              </div>
                              <span className="w-12 text-right font-mono text-[11px]" style={{ color: '#4e4e56' }}>{percent.toFixed(1)}%</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
