const dateFmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
const monthFmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", timeZone: "UTC" })

export function formatDate(d?: string | null): string {
  if (!d) return "—"
  const date = new Date(d.length === 10 ? `${d}T00:00:00Z` : d)
  return Number.isNaN(date.getTime()) ? d : dateFmt.format(date)
}

export function formatMonth(d?: string | null): string {
  if (!d) return "—"
  const date = new Date(`${d.slice(0, 7)}-01T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? d : monthFmt.format(date)
}

export function formatNumber(n?: number | null, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return n.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function compact(n?: number | null): string {
  if (n === null || n === undefined) return "—"
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days} d ago`
  return formatDate(iso)
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}
