import { useState, useEffect, useMemo } from 'react'
import { HardDrive, ChevronRight, Folder, File, RefreshCw } from 'lucide-react'
import { Treemap, ResponsiveContainer } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { cn, formatBytes } from '@/lib/utils'
import type { DiskNode, DriveInfo } from '@shared/types'

const COLORS = ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#a16207', '#ca8a04', '#eab308', '#facc15', '#fbbf24']

export function DiskAnalyzerPage() {
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [selectedDrive, setSelectedDrive] = useState('C')
  const [data, setData] = useState<DiskNode | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [breadcrumb, setBreadcrumb] = useState<DiskNode[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.dustforge?.diskDrives?.().then(setDrives).catch((err) => {
      console.error('Failed to load drives:', err)
    })
  }, [])

  const handleAnalyze = async () => {
    setAnalyzing(true); setData(null); setBreadcrumb([]); setError(null)
    try {
      const result = await window.dustforge.diskAnalyze(selectedDrive)
      setData(result); setBreadcrumb([result])
    } catch (err) {
      console.error('Disk analysis failed:', err)
      setError(`Failed to analyze drive ${selectedDrive}:. Make sure the drive is accessible.`)
    }
    setAnalyzing(false)
  }

  const currentNode = breadcrumb[breadcrumb.length - 1] ?? data
  const treemapData = useMemo(() => {
    if (!currentNode?.children) return []
    return currentNode.children.sort((a, b) => b.size - a.size).map((c, i) => ({ name: c.name, size: c.size, fill: COLORS[i % COLORS.length] }))
  }, [currentNode])

  const drillDown = (node: DiskNode) => { if (node.children?.length) setBreadcrumb((p) => [...p, node]) }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Disk Analyzer" description="Visualize disk space usage"
        action={
          <div className="flex items-center gap-2.5">
            <select value={selectedDrive} onChange={(e) => setSelectedDrive(e.target.value)}
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

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} className="mb-5" />}

      {analyzing && <ScanProgress status="scanning" progress={0} currentPath={`Analyzing ${selectedDrive}:\\...`} className="mb-5" />}
      {!data && !analyzing && !error && <EmptyState icon={HardDrive} title="No analysis data" description="Select a drive and click Analyze to visualize disk space usage." />}

      {data && currentNode && (
        <>
          {/* Breadcrumb */}
          <div className="mb-5 flex items-center gap-1">
            {breadcrumb.map((node, i) => (
              <div key={node.path} className="flex items-center">
                {i > 0 && <ChevronRight className="mx-1 h-3 w-3" style={{ color: '#3a3a42' }} />}
                <button onClick={() => setBreadcrumb((p) => p.slice(0, i + 1))}
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
              <ResponsiveContainer width="100%" height={280}>
                <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                  <defs>
                    <linearGradient id="textGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
                      <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                    </linearGradient>
                  </defs>
                </svg>
                <Treemap data={treemapData} dataKey="size" nameKey="name" stroke="#0c0c0e" strokeWidth={3}
                  content={({ x, y, width, height, name, fill }: any) => {
                    if (width < 20 || height < 16) return null
                    return (
                      <g>
                        <rect x={x} y={y} width={width} height={height} fill={fill} rx={6} className="cursor-pointer opacity-75 hover:opacity-100 transition-opacity" />
                        <rect x={x} y={y} width={width} height={Math.min(height, 48)} fill="url(#textGradient)" rx={6} />
                        {width > 55 && height > 28 && <text x={x + 10} y={y + 20} fill="#fff" fontSize={12} fontWeight={600} style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{name}</text>}
                        {width > 75 && height > 42 && <text x={x + 10} y={y + 36} fill="rgba(255,255,255,0.8)" fontSize={10} style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{formatBytes(treemapData.find((d: any) => d.name === name)?.size ?? 0)}</text>}
                      </g>
                    )
                  }}
                />
              </ResponsiveContainer>
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
                {currentNode.children.sort((a, b) => b.size - a.size).map((child) => {
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
    </div>
  )
}
