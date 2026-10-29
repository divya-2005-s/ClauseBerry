"use client"

import { BarChart3, Table2 } from "lucide-react"
import { useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** Shared chart constants (dataviz spec: thin bars ≤24px, 4px rounded data-ends, 2px lines, hairline grid). */
export const BAR_SIZE = 22
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0]
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0]
export const AXIS = {
  tick: { fill: "var(--muted-foreground)", fontSize: 12 },
  axisLine: false,
  tickLine: false,
} as const
export const GRID = { stroke: "var(--grid)", strokeDasharray: undefined, vertical: false } as const
export const RISK_COLORS = ["var(--risk-1)", "var(--risk-2)", "var(--risk-3)", "var(--risk-4)", "var(--risk-5)"]

export type TableSpec = { columns: string[]; rows: (string | number | null)[][] }

/** Card that holds one chart, with an accessible "view as table" alternative. */
export function ChartCard({
  title,
  description,
  table,
  legend,
  children,
  className,
  actions,
}: {
  title: string
  description?: React.ReactNode
  table?: TableSpec
  legend?: React.ReactNode
  children: React.ReactNode
  className?: string
  actions?: React.ReactNode
}) {
  const [view, setView] = useState<"chart" | "table">("chart")
  return (
    <section className={cn("card-soft flex min-w-0 flex-col p-5", className)} aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && (
            <div className="flex rounded-lg border p-0.5" role="group" aria-label="Display">
              {(["chart", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  aria-label={v === "chart" ? "Show chart" : "Show table"}
                  className={cn(
                    "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
                    view === v && "bg-secondary text-secondary-foreground",
                  )}
                >
                  {v === "chart" ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {legend && view === "chart" && <div className="mb-2">{legend}</div>}
      {view === "chart" || !table ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {table.columns.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((v, j) => (
                    <TableCell key={j} className={cn("tabular-nums", j === 0 && "font-medium")}>
                      {v ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

export function Legend({ items }: { items: { label: string; color: string; shape?: "line" | "square" }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(i.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]")}
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

type TooltipPayload = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }

/** Tooltip: values lead (strong), labels follow; series keyed by a short line in the series colour. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v) => String(v),
  names,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string | number
  labelFormatter?: (l: string | number | undefined, p?: TooltipPayload[]) => React.ReactNode
  valueFormatter?: (v: number | string, key?: string) => string
  names?: Record<string, string>
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-[var(--shadow-lift)]">
      <div className="mb-1.5 font-medium">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
            <strong className="font-semibold tabular-nums">{valueFormatter(p.value ?? 0, String(p.dataKey))}</strong>
            <span className="text-muted-foreground">{names?.[String(p.dataKey)] ?? p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChartEmpty({ message = "No data for this selection." }: { message?: string }) {
  return <div className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground">{message}</div>
}
