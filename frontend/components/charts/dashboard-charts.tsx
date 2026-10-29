"use client"

import Link from "next/link"
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { RISK_LABELS } from "@/components/common/badges"
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { compact, formatNumber } from "@/lib/format"


import {
  AXIS,
  BAR_RADIUS,
  BAR_RADIUS_H,
  BAR_SIZE,
  ChartCard,
  ChartEmpty,
  ChartTooltip,
  GRID,
  Legend,
  RISK_COLORS,
} from "./chart-kit"

type TimelineRow = { period: string; changes: number; high_risk: number; medium_risk: number; low_risk: number }

const BANDS = [
  { key: "low_risk", label: "Minimal–low (1–2)", color: "var(--risk-1)" },
  { key: "medium_risk", label: "Medium (3)", color: "var(--risk-3)" },
  { key: "high_risk", label: "High–critical (4–5)", color: "var(--risk-5)" },
] as const

export function ChangesTimelineChart({ data }: { data: TimelineRow[] }) {
  const names = Object.fromEntries(BANDS.map((b) => [b.key, b.label]))
  return (
    <ChartCard
      title="Meaningful policy changes over time"
      description="Per quarter, stacked by assessed risk. Formatting-only edits and capture glitches are excluded."
      legend={<Legend items={BANDS.map((b) => ({ label: b.label, color: b.color }))} />}
      table={{ columns: ["Quarter", "Total", "Low", "Medium", "High"], rows: data.map((d) => [d.period, d.changes, d.low_risk, d.medium_risk, d.high_risk]) }}
    >
      {data.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="period" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...AXIS} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={<ChartTooltip names={names} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.changes ?? 0} changes`} />}
              />
              {BANDS.map((b, i) => (
                <Bar
                  key={b.key}
                  dataKey={b.key}
                  stackId="risk"
                  fill={b.color}
                  stroke="var(--card)"
                  strokeWidth={1}
                  maxBarSize={BAR_SIZE}
                  radius={i === BANDS.length - 1 ? BAR_RADIUS : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

export function RiskDistributionChart({ data }: { data: { risk_score: number; risk_level: string; changes: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: RISK_LABELS[d.risk_score] }))
  const total = rows.reduce((s, r) => s + r.changes, 0)
  return (
    <ChartCard
      title="Risk distribution"
      description="How many meaningful changes received each score (1 = editorial, 5 = critical)."
      table={{ columns: ["Score", "Level", "Changes", "Share"], rows: rows.map((r) => [r.risk_score, r.label, r.changes, total ? `${Math.round((r.changes / total) * 100)}%` : "—"]) }}
    >
      {total === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 18, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={
                  <ChartTooltip
                    names={{ changes: "changes" }}
                    labelFormatter={(l, p) => `${l} (score ${p?.[0]?.payload?.risk_score})`}
                    valueFormatter={(v) => `${v} · ${total ? Math.round((Number(v) / total) * 100) : 0}%`}
                  />
                }
              />
              <Bar dataKey="changes" maxBarSize={BAR_SIZE * 1.6} radius={BAR_RADIUS} label={{ position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}>
                {rows.map((r) => (
                  <Cell key={r.risk_score} fill={RISK_COLORS[r.risk_score - 1]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

export function CategoryChart({ data }: { data: { category: string; label: string; changes: number; avg_risk: number }[] }) {
  return (
    <ChartCard
      title="Changes by category"
      description="Primary topic of each meaningful change."
      table={{ columns: ["Category", "Changes", "Avg risk"], rows: data.map((d) => [d.label, d.changes, d.avg_risk]) }}
    >
      {data.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div style={{ height: Math.max(180, data.length * 30 + 20) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical horizontal={false} />
              <XAxis type="number" {...AXIS} allowDecimals={false} hide />
              <YAxis type="category" dataKey="label" {...AXIS} width={150} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={
                  <ChartTooltip
                    names={{ changes: "changes" }}
                    labelFormatter={(l, p) => `${l} · avg risk ${p?.[0]?.payload?.avg_risk ?? "—"}`}
                  />
                }
              />
              <Bar dataKey="changes" fill="var(--chart-1)" maxBarSize={16} radius={BAR_RADIUS_H} label={{ position: "right", fill: "var(--muted-foreground)", fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

type Ranking = { app_name: string; app_slug: string; app_category: string; changes: number; avg_risk: number; high_risk: number; max_risk: number }

export function RankingList({ data }: { data: Ranking[] }) {
  return (
    <ChartCard
      title="Application risk ranking"
      description="Ranked by number of high-risk (4–5) changes, then average score."
      table={{ columns: ["App", "Changes", "High-risk", "Avg risk"], rows: data.map((d) => [d.app_name, d.changes, d.high_risk, d.avg_risk]) }}
    >
      {data.length === 0 ? (
        <ChartEmpty />
      ) : (
        <ol className="space-y-2.5">
          {data.slice(0, 8).map((r, i) => (
            <li key={r.app_slug}>
              <Link href={`/apps/${r.app_slug}`} className="group flex items-center gap-3 rounded-lg p-1 -m-1 hover:bg-muted/60">
                <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="w-28 truncate text-sm font-medium group-hover:text-primary">{r.app_name}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.avg_risk / 5) * 100}%`, background: RISK_COLORS[Math.round(r.avg_risk) - 1] }} />
                </span>
                <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
                  <strong className="font-semibold text-foreground">{r.high_risk}</strong> high · {r.avg_risk.toFixed(1)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  )
}

export function AiTimelineChart({ data }: { data: { period: string; explicit_training: number; ai_provider_sharing: number; any_ai: number }[] }) {
  const series = [
    { key: "any_ai", label: "Any AI / automated-processing language", color: "var(--chart-3)" },
    { key: "explicit_training", label: "Explicit model-training language", color: "var(--chart-2)" },
    { key: "ai_provider_sharing", label: "Sharing with AI providers", color: "var(--chart-1)" },
  ]
  const names = Object.fromEntries(series.map((s) => [s.key, s.label]))
  return (
    <ChartCard
      title="AI-related language over time"
      description="Apps with each kind of clause in any version captured that quarter."
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: "line" }))} />}
      table={{ columns: ["Quarter", "Any AI", "Explicit training", "AI providers"], rows: data.map((d) => [d.period, d.any_ai, d.explicit_training, d.ai_provider_sharing]) }}
    >
      {data.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="period" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...AXIS} allowDecimals={false} width={44} />
              <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} content={<ChartTooltip names={names} valueFormatter={(v) => `${v} apps`} />} />
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

export function PolicyLengthChart({ data }: { data: { period: string; privacy_policy: number | null; terms_of_service: number | null }[] }) {
  const series = [
    { key: "privacy_policy", label: "Privacy policies", color: "var(--chart-1)" },
    { key: "terms_of_service", label: "Terms of service", color: "var(--chart-2)" },
  ]
  const names = Object.fromEntries(series.map((s) => [s.key, s.label]))
  return (
    <ChartCard
      title="Average policy length"
      description="Mean word count of the last version captured each quarter, across documents in the archive."
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: "line" }))} />}
      table={{ columns: ["Quarter", "Privacy policy (words)", "Terms (words)"], rows: data.map((d) => [d.period, d.privacy_policy, d.terms_of_service]) }}
    >
      {data.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="period" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...AXIS} width={44} tickFormatter={(v) => compact(v)} />
              <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} content={<ChartTooltip names={names} valueFormatter={(v) => `${formatNumber(Number(v))} words`} />} />
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

type Heat = { apps: string[]; categories: string[]; category_labels: Record<string, string>; cells: { app_name: string; app_slug: string; category: string; changes: number }[] }

export function CategoryHeatmap({ data }: { data: Heat }) {
  const cats = data.categories.filter((c) => data.cells.some((x) => x.category === c))
  const lookup = new Map(data.cells.map((c) => [`${c.app_name}|${c.category}`, c]))
  const slugs = new Map(data.cells.map((c) => [c.app_name, c.app_slug]))
  const max = Math.max(1, ...data.cells.map((c) => c.changes))
  const step = (n: number) => (n === 0 ? 0 : Math.min(5, Math.ceil((n / max) * 5)))
  return (
    <ChartCard
      title="Application × category heatmap"
      description="Number of meaningful changes per app and topic. Darker = more changes."
      table={{
        columns: ["App", ...cats.map((c) => data.category_labels[c])],
        rows: data.apps.map((a) => [a, ...cats.map((c) => lookup.get(`${a}|${c}`)?.changes ?? 0)]),
      }}
      legend={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Fewer</span>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="size-3 rounded-[3px] border border-border/50" style={{ background: `var(--heat-${i})` }} aria-hidden />
          ))}
          <span>More (max {max})</span>
        </div>
      }
    >
      {data.apps.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-[2px] text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card" />
                {cats.map((c) => (
                  <th key={c} scope="col" className="h-24 min-w-9 align-bottom font-normal text-muted-foreground">
                    <span className="inline-block max-h-24 -rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">{data.category_labels[c]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.apps.map((a) => (
                <tr key={a}>
                  <th scope="row" className="sticky left-0 bg-card pr-2 text-left font-medium whitespace-nowrap">
                    <Link href={`/apps/${slugs.get(a)}`} className="hover:text-primary">
                      {a}
                    </Link>
                  </th>
                  {cats.map((c) => {
                    const n = lookup.get(`${a}|${c}`)?.changes ?? 0
                    const s = step(n)
                    return (
                      <td key={c} className="p-0">
                        <UiTooltip>
                          <TooltipTrigger asChild>
                            <div
                              tabIndex={0}
                              aria-label={`${a}, ${data.category_labels[c]}: ${n} changes`}
                              className="h-7 min-w-9 rounded-[4px] outline-offset-1"
                              style={{ background: `var(--heat-${s})` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <strong>{n}</strong> {n === 1 ? "change" : "changes"} · {a} · {data.category_labels[c]}
                          </TooltipContent>
                        </UiTooltip>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  )
}
