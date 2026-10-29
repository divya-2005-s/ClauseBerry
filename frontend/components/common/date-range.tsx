"use client"

import { CalendarRange } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type DateRange = { key: string; from?: string; to?: string; label: string }

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function dateRangePresets(firstYear = 2022, lastYear = new Date().getUTCFullYear()): DateRange[] {
  const now = new Date()
  const back = (months: number) => {
    const d = new Date(now)
    d.setUTCMonth(d.getUTCMonth() - months)
    return iso(d)
  }
  const presets: DateRange[] = [
    { key: "all", label: "All time" },
    { key: "12m", label: "Last 12 months", from: back(12) },
    { key: "24m", label: "Last 24 months", from: back(24) },
  ]
  for (let y = lastYear; y >= firstYear; y--) presets.push({ key: String(y), label: String(y), from: `${y}-01-01`, to: `${y}-12-31` })
  return presets
}

export function DateRangeSelect({ value, onChange, presets }: { value: string; onChange: (r: DateRange) => void; presets: DateRange[] }) {
  return (
    <Select value={value} onValueChange={(k) => onChange(presets.find((p) => p.key === k) ?? presets[0])}>
      <SelectTrigger className="h-9 w-44 bg-card" aria-label="Date range">
        <CalendarRange className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {presets.map((p) => (
          <SelectItem key={p.key} value={p.key}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
