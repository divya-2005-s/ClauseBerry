"use client"

import { useRouter } from "next/navigation"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts"

import { AXIS, BAR_RADIUS_H, ChartCard, ChartEmpty, ChartTooltip, GRID, Legend } from "@/components/charts/chart-kit"
import { RISK_LABELS } from "@/components/common/badges"
import { compact, formatDate, formatNumber } from "@/lib/format"

const DOC_SERIES = [
  { key: "Privacy Policy", label: "Privacy policy", color: "var(--chart-1)" },
  { key: "Terms of Service", label: "Terms of service", color: "var(--chart-2)" },
]
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`)
const tickDate = (v: number) => new Date(v).toLocaleDateString("en", { year: "2-digit", month: "short", timeZone: "UTC" })

type TimelinePoint = { change_date: string; document_type: string; risk_score: number | null; category: string | null; change_id: number }

export function RiskTimeline({ slug, data, labels }: { slug: string; data: TimelinePoint[]; labels: Record<string, string> }) {
  const router = useRouter()
  const pts = data.filter((d) => d.risk_score).map((d) => ({ ...d, x: ts(d.change_date), y: d.risk_score as number }))
  return (
    <ChartCard
      title="Change timeline"
      description="Each dot is a meaningful change, placed by date and assessed risk. Select a dot to open it."
      legend={<Legend items={DOC_SERIES.map((s) => ({ label: s.label, color: s.color }))} />}
      table={{ columns: ["Date", "Document", "Risk", "Category"], rows: pts.map((p) => [p.change_date, p.document_type, p.y, labels[p.category ?? ""] ?? p.category]) }}
    >
      {pts.length === 0 ? (
        <ChartEmpty message="No analysed changes yet." />
      ) : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="x" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={tickDate} {...AXIS} minTickGap={24} />
              <YAxis type="number" dataKey="y" domain={[0.5, 5.5]} ticks={[1, 2, 3, 4, 5]} tickFormatter={(v) => RISK_LABELS[v] ?? ""} {...AXIS} width={70} />
              <ZAxis range={[70, 70]} />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof pts)[number] | undefined
                  if (!active || !p) return null
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-[var(--shadow-lift)]">
                      <div className="font-medium">{formatDate(p.change_date)} · {p.document_type}</div>
                      <div className="mt-1">
                        <strong>{RISK_LABELS[p.y]}</strong> ({p.y}/5) · <span className="text-muted-foreground">{labels[p.category ?? ""] ?? p.category}</span>
                      </div>
                    </div>
                  )
                }}
              />
              {DOC_SERIES.map((s) => (
                <Scatter
                  key={s.key}
                  name={s.label}
                  data={pts.filter((p) => p.document_type === s.key)}
                  fill={s.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                  className="cursor-pointer"
                  onClick={(p) => router.push(`/apps/${slug}/changes/${(p as unknown as { change_id: number }).change_id}`)}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

export function AppCategoryBars({ data, labels }: { data: { category: string; changes: number; avg_risk: number }[]; labels: Record<string, string> }) {
  const rows = data.map((d) => ({ ...d, label: labels[d.category] ?? d.category }))
  return (
    <ChartCard
      title="What the changes were about"
      description="Primary category of each meaningful change."
      table={{ columns: ["Category", "Changes", "Avg risk"], rows: rows.map((r) => [r.label, r.changes, r.avg_risk]) }}
    >
      {rows.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div style={{ height: Math.max(140, rows.length * 30 + 10) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...AXIS} width={150} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip names={{ changes: "changes" }} />} />
              <Bar dataKey="changes" fill="var(--chart-1)" maxBarSize={14} radius={BAR_RADIUS_H} label={{ position: "right", fill: "var(--muted-foreground)", fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

export function LengthHistory({ data }: { data: { version_date: string; document_type: string; word_count: number }[] }) {
  // Merge into one series per document type on a shared time axis.
  const byDate = new Map<number, Record<string, number>>()
  for (const d of data) {
    const x = ts(d.version_date)
    byDate.set(x, { ...(byDate.get(x) ?? { x }), [d.document_type]: d.word_count })
  }
  const rows = [...byDate.values()].sort((a, b) => a.x - b.x)
  const names = Object.fromEntries(DOC_SERIES.map((s) => [s.key, s.label]))
  return (
    <ChartCard
      title="Policy length over time"
      description="Word count of each clean archived version."
      legend={<Legend items={DOC_SERIES.map((s) => ({ label: s.label, color: s.color, shape: "line" }))} />}
      table={{ columns: ["Date", "Document", "Words"], rows: data.map((d) => [d.version_date, d.document_type, d.word_count]) }}
    >
      {rows.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="x" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={tickDate} {...AXIS} minTickGap={24} />
              <YAxis {...AXIS} width={44} tickFormatter={(v) => compact(v)} />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                content={<ChartTooltip names={names} labelFormatter={(l) => formatDate(new Date(Number(l)).toISOString())} valueFormatter={(v) => `${formatNumber(Number(v))} words`} />}
              />
              {DOC_SERIES.map((s) => (
                <Line key={s.key} type="stepAfter" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
