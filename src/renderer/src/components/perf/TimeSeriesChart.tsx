import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { PerfSnapshot } from '@shared/types'

interface TimeSeriesChartProps {
  history: PerfSnapshot[]
  timeRange: '60s' | '5m' | '15m'
  dataKey: 'cpu' | 'memory' | 'disk'
  label: string
  color: string
}

const rangeSeconds = { '60s': 60, '5m': 300, '15m': 900 }

export function TimeSeriesChart({ history, timeRange, dataKey, label, color }: TimeSeriesChartProps) {
  const data = useMemo(() => {
    const count = rangeSeconds[timeRange]
    const slice = history.slice(-count)

    return slice.map((s, i) => {
      if (dataKey === 'cpu') {
        return { t: i, value: s.cpu.overall }
      }
      if (dataKey === 'memory') {
        return { t: i, value: s.memory.percent }
      }
      // disk: combined read+write in MB/s
      return {
        t: i,
        read: s.disk.readBytesPerSec / (1024 * 1024),
        write: s.disk.writeBytesPerSec / (1024 * 1024)
      }
    })
  }, [history, timeRange, dataKey])

  const isDisk = dataKey === 'disk'
  const gradientId = `gradient-${dataKey}`

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: '#16161a', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="mb-3 text-[12px] font-semibold text-zinc-400">{label}</div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            {isDisk && (
              <linearGradient id="gradient-disk-write" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            )}
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis
            hide
            domain={isDisk ? ['auto', 'auto'] : [0, 100]}
          />
          <Tooltip
            contentStyle={{
              background: '#1e1e24',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#d4d4d8'
            }}
            labelFormatter={() => ''}
            formatter={(val) =>
              isDisk ? [`${Number(val).toFixed(1)} MB/s`] : [`${Number(val).toFixed(1)}%`]
            }
          />
          {isDisk ? (
            <>
              <Area
                type="monotone"
                dataKey="read"
                stroke={color}
                fill={`url(#${gradientId})`}
                strokeWidth={1.5}
                isAnimationActive={false}
                name="Read"
              />
              <Area
                type="monotone"
                dataKey="write"
                stroke="#ef4444"
                fill="url(#gradient-disk-write)"
                strokeWidth={1.5}
                isAnimationActive={false}
                name="Write"
              />
            </>
          ) : (
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              fill={`url(#${gradientId})`}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
