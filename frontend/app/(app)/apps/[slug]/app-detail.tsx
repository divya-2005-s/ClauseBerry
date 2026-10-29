"use client"

import {
  Activity,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  GitCompareArrows,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { AppAvatar } from "@/components/common/app-avatar"
import { AiStatusBadge, AnalyzerBadge, CategoryBadge, RiskBadge } from "@/components/common/badges"
import { FollowButton } from "@/components/common/follow-button"
import { AiDisclaimer, KpiCard, Notice } from "@/components/common/page"
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebounce } from "@/hooks/use-debounce"
import { useMeta } from "@/hooks/use-meta"
import { api, qs } from "@/lib/api"
import { formatDate, formatNumber } from "@/lib/format"
import type { AiStatus, Analysis, ChangeRow, Paged } from "@/lib/types"

import { AiHistory } from "./ai-history"
import { AppCategoryBars, LengthHistory, RiskTimeline } from "./app-charts"

type Detail = {
  app: { id: number; slug: string; name: string; category: string; website: string | null; description: string | null; note: string | null }
  documents: {
    id: number
    document_type: string
    source_url: string | null
    versions: number
    flagged_versions: number
    coverage_start: string
    meaningful_changes: number
    raw_changes: number
    latest_version: { id: number; version_date: string; word_count: number; source: string } | null
  }[]
  latest_change: (Analysis & { change_date: string; document_type: string; change_id?: number; id: number }) | null
  stats: { meaningful_changes: number; avg_risk: number | null; high_risk: number | null; ai_training_changes: number | null }
  category_distribution: { category: string; changes: number; avg_risk: number }[]
  timeline: { change_date: string; document_type: string; risk_score: number | null; category: string | null; change_id: number }[]
  length_history: { version_date: string; document_type: string; word_count: number }[]
  ai_status: AiStatus
  following: boolean
  monitoring: {
    status: "healthy" | "changed" | "failed" | "not_checked"
    last_checked_at: string | null
    last_successful_check_at: string | null
    next_check_at: string | null
    documents: {
      document_type: string
      status: "healthy" | "changed" | "failed" | "not_checked"
      last_checked_at: string | null
      last_successful_check_at: string | null
      http_status: number | null
    }[]
  }
}

const DIRECTION_LABEL: Record<string, string> = {
  expanded_permission: "Expands permissions",
  reduced_permission: "Narrows permissions",
  clarification: "Clarification",
  editorial: "Editorial",
  mixed: "Mixed revisions",
}

export function AppDetail({ slug }: { slug: string }) {
  const { data, error, mutate } = useSWR<Detail>(`/api/apps/${slug}`)
  const { categories } = useMeta()
  const [monitoringRun, setMonitoringRun] = useState<number | null>(null)

  useEffect(() => {
    if (monitoringRun === null) return
    let cancelled = false
    let timer: number
    const startedAt = Date.now()
    async function poll() {
      try {
        const run = await api<{ status: string; summary: { changed?: number; failed?: number } }>(
          `/api/monitoring/runs/${monitoringRun}`,
        )
        if (run.status === "success" || run.status === "partial" || run.status === "failed") {
          await mutate()
          if (cancelled) return
          if (run.status === "success") toast.success(`Policy check complete. ${run.summary.changed ?? 0} new versions found.`)
          else toast.warning(run.status === "partial" ? "Policy check finished with some failed sources." : "Policy check failed.")
          setMonitoringRun(null)
          return
        }
      } catch (e) {
        if (!cancelled) {
          toast.error((e as Error).message)
          setMonitoringRun(null)
        }
        return
      }
      if (Date.now() - startedAt > 10 * 60_000) {
        if (!cancelled) {
          toast.info("The policy check is still running. You can review its status on the Monitoring page.")
          setMonitoringRun(null)
        }
        return
      }
      if (!cancelled) timer = window.setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [monitoringRun, mutate])

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (!data)
    return (
      <div className="space-y-4">
        <CardSkeleton lines={2} />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} lines={1} />
          ))}
        </div>
        <CardSkeleton lines={6} />
      </div>
    )

  const { app, stats } = data
  const lc = data.latest_change
  async function checkNow() {
    try {
      const run = await api<{ id: number }>(`/api/monitoring/apps/${slug}/check`, { method: "POST" })
      setMonitoringRun(run.id)
      toast.info("Policy check started.")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <Link href="/apps" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> All applications
      </Link>

      <header className="card-soft relative mb-5 overflow-hidden p-5 sm:p-6">
        <div className="bg-berry-glow pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
          <AppAvatar name={app.name} className="size-14 rounded-2xl text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{app.name}</h1>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{app.category}</span>
            </div>
            {app.description && <p className="mt-1 text-sm text-muted-foreground">{app.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AiStatusBadge status={data.ai_status} />
              {app.website && (
                <a href={app.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  {app.website.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {app.note && <p className="mt-2 text-xs text-muted-foreground">{app.note}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="bg-card" onClick={checkNow} disabled={monitoringRun !== null}>
              <RefreshCw className={monitoringRun !== null ? "animate-spin" : undefined} />
              {monitoringRun !== null ? "Checking…" : "Check now"}
            </Button>
            <Button asChild variant="outline" size="sm" className="bg-card">
              <a href={`/api/exports/changes.csv?app=${app.slug}`}>
                <Download /> CSV
              </a>
            </Button>
            <FollowButton slug={app.slug} name={app.name} following={data.following} onChange={() => mutate()} />
          </div>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Meaningful changes" value={formatNumber(stats.meaningful_changes)} icon={Activity} />
        <KpiCard label="Average risk" value={stats.avg_risk?.toFixed(2) ?? "—"} icon={TrendingUp} tone="neutral" />
        <KpiCard label="High-risk changes" value={formatNumber(stats.high_risk ?? 0)} icon={ShieldAlert} tone="coral" />
        <KpiCard label="Adds AI-training language" value={formatNumber(stats.ai_training_changes ?? 0)} icon={Sparkles} tone="coral" />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card-soft p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold tracking-tight">Latest meaningful change</h2>
            {lc && <AnalyzerBadge analyzer={lc.analyzer} model={lc.model} />}
          </div>
          {lc ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <RiskBadge score={lc.risk_score} />
                <CategoryBadge label={lc.category_label ?? categories[lc.category] ?? lc.category} />
                <span className="text-muted-foreground">
                  {lc.document_type} · {formatDate(lc.change_date)}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{lc.summary}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                <strong className="font-medium text-foreground">Why this score:</strong> {lc.reasoning}
              </p>
              {lc.ai_training_evidence && (
                <blockquote className="mt-3 rounded-lg border-l-2 border-coral bg-coral-soft px-3 py-2 text-sm">
                  “{lc.ai_training_evidence}”
                </blockquote>
              )}
              <Button asChild variant="link" className="mt-2 h-auto px-0">
                <Link href={`/apps/${slug}/changes/${lc.change_id ?? lc.id}`}>
                  See the full comparison <ArrowRight />
                </Link>
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No meaningful changes detected in the archived history.</p>
          )}
        </section>
        <section className="card-soft p-5">
          <h2 className="mb-3 font-semibold tracking-tight">Documents</h2>
          <ul className="space-y-3">
            {data.documents.map((d) => (
              <li key={d.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-sm font-medium">
                    <FileText className="size-4 text-primary" /> {d.document_type}
                  </span>
                  {d.latest_version && (
                    <Link href={`/apps/${slug}/versions/${d.latest_version.id}`} className="text-xs font-medium text-primary hover:underline">
                      Read latest
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.latest_version
                    ? `Latest ${formatDate(d.latest_version.version_date)} · ${formatNumber(d.latest_version.word_count)} words`
                    : "No clean version available"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.versions} versions since {formatDate(d.coverage_start)} · {d.meaningful_changes} meaningful of {d.raw_changes} raw changes
                  {d.flagged_versions > 0 && ` · ${d.flagged_versions} capture errors excluded`}
                </p>
                {(() => {
                  const check = data.monitoring.documents.find((item) => item.document_type === d.document_type)
                  if (!check) return null
                  const label = check.status.replace("_", " ")
                  return (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Monitoring: <span className="font-medium capitalize text-foreground">{label}</span>
                      {check.last_checked_at && ` · Last checked ${new Date(check.last_checked_at).toLocaleString()}`}
                      {check.last_successful_check_at &&
                        ` · Last successful ${new Date(check.last_successful_check_at).toLocaleString()}`}
                      {check.status === "failed" && check.http_status && ` · HTTP ${check.http_status}`}
                    </p>
                  )
                })()}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Tabs defaultValue="changes">
        <TabsList className="mb-4">
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="ai">AI training</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>
        <TabsContent value="changes">
          <ChangesList slug={slug} categories={categories} />
        </TabsContent>
        <TabsContent value="insights" className="space-y-5">
          <RiskTimeline slug={slug} data={data.timeline} labels={categories} />
          <div className="grid gap-5 lg:grid-cols-2">
            <AppCategoryBars data={data.category_distribution} labels={categories} />
            <LengthHistory data={data.length_history} />
          </div>
        </TabsContent>
        <TabsContent value="ai">
          <AiHistory slug={slug} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsPanel slug={slug} />
        </TabsContent>
      </Tabs>
      <AiDisclaimer className="mt-6" />
    </div>
  )
}

const ALL = "all"

function ChangesList({ slug, categories }: { slug: string; categories: Record<string, string> }) {
  const [doc, setDoc] = useState(ALL)
  const [minRisk, setMinRisk] = useState(ALL)
  const [year, setYear] = useState(ALL)
  const [q, setQ] = useState("")
  const [noise, setNoise] = useState(false)
  const [page, setPage] = useState(1)
  const dq = useDebounce(q, 300)
  const resetting = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  const key = `/api/apps/${slug}/changes${qs({
    document_type: doc === ALL ? undefined : doc,
    min_risk: minRisk === ALL ? undefined : minRisk,
    date_from: year === ALL ? undefined : `${year}-01-01`,
    date_to: year === ALL ? undefined : `${year}-12-31`,
    q: dq,
    include_noise: noise || undefined,
    page,
    page_size: 10,
  })}`
  const { data, error, isLoading, mutate } = useSWR<Paged<ChangeRow>>(key, { keepPreviousData: true })
  const years = ["2026", "2025", "2024", "2023", "2022"]

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => resetting(setQ)(e.target.value)} placeholder="Search added or removed text…" aria-label="Search changes" className="h-9 bg-card pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={doc} onValueChange={resetting(setDoc)}>
            <SelectTrigger className="h-9 bg-card sm:w-44" aria-label="Document">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Both documents</SelectItem>
              <SelectItem value="Privacy Policy">Privacy policy</SelectItem>
              <SelectItem value="Terms of Service">Terms of service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={resetting(setYear)}>
            <SelectTrigger className="h-9 bg-card sm:w-32" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minRisk} onValueChange={resetting(setMinRisk)}>
            <SelectTrigger className="h-9 bg-card sm:w-36" aria-label="Minimum risk">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any risk</SelectItem>
              <SelectItem value="3">Medium+</SelectItem>
              <SelectItem value="4">High+</SelectItem>
              <SelectItem value="5">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={noise ? "secondary" : "outline"} className="h-9 bg-card" aria-pressed={noise} onClick={() => resetting(setNoise)(!noise)}>
            {noise ? "Hide noise" : "Show noise"}
          </Button>
        </div>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <CardSkeleton key={i} lines={2} />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={Activity} title="No changes match" description="Try another year, document or risk level." />
      ) : (
        <>
          <ol className={`space-y-3 ${isLoading ? "opacity-70" : ""}`}>
            {data.items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/apps/${slug}/changes/${c.id}`}
                  className="card-soft group block p-4 transition-shadow hover:shadow-[var(--shadow-lift)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{formatDate(c.change_date)}</span>
                    <span className="text-xs text-muted-foreground">{c.document_type}</span>
                    <span className="flex-1" />
                    {c.is_meaningful ? (
                      <>
                        {c.ai_training_mentioned && (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-coral-soft px-2 text-xs font-medium">
                            <Sparkles className="size-3 text-coral" /> AI training
                          </span>
                        )}
                        <CategoryBadge label={c.category_label ?? categories[c.category ?? ""] ?? c.category} />
                        <RiskBadge score={c.risk_score} />
                      </>
                    ) : (
                      <span className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                        Noise: {c.noise_reason?.replaceAll("_", " ")}
                      </span>
                    )}
                  </div>
                  {c.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="text-success">+{formatNumber(c.words_added)} words</span>
                    <span className="text-critical">−{formatNumber(c.words_removed)} words</span>
                    {c.change_direction && <span>{DIRECTION_LABEL[c.change_direction] ?? c.change_direction}</span>}
                    <span className="ml-auto inline-flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      Compare <ArrowRight className="size-3" />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.total} changes</span>
            {data.pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <span className="tabular-nums">
                  {data.page} / {data.pages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

type VersionRow = { id: number; version_date: string; word_count: number; source: string; quality_flag: string; document_type: string; training_clauses: number }

function VersionsPanel({ slug }: { slug: string }) {
  const router = useRouter()
  const [doc, setDocState] = useState("Privacy Policy")
  const { data, error } = useSWR<{ items: VersionRow[] }>(`/api/apps/${slug}/versions${qs({ document_type: doc })}`)
  const [from, setFrom] = useState<string>("")
  const [to, setTo] = useState<string>("")
  function setDoc(d: string) {
    setDocState(d)
    setFrom("")
    setTo("")
  }
  const clean = data?.items.filter((v) => v.quality_flag === "ok") ?? []

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="card-soft p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold tracking-tight">Version history</h2>
          <Select value={doc} onValueChange={setDoc}>
            <SelectTrigger className="h-9 w-48 bg-card" aria-label="Document">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Privacy Policy">Privacy policy</SelectItem>
              <SelectItem value="Terms of Service">Terms of service</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} />
        ) : !data ? (
          <CardSkeleton lines={6} />
        ) : (
          <div className="max-h-[480px] overflow-y-auto pr-1">
            <ul className="divide-y">
              {data.items.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-28 font-medium tabular-nums">{formatDate(v.version_date)}</span>
                  <span className="w-24 text-xs text-muted-foreground tabular-nums">{formatNumber(v.word_count)} words</span>
                  <span className="flex flex-1 flex-wrap gap-1">
                    {v.quality_flag !== "ok" && <span className="rounded-full border border-dashed px-2 text-[11px] text-muted-foreground">capture error</span>}
                    {v.training_clauses > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-2 text-[11px]">
                        <Sparkles className="size-3 text-coral" /> training language
                      </span>
                    )}
                    {v.source === "fetched" && <span className="rounded-full bg-secondary px-2 text-[11px]">fetched</span>}
                  </span>
                  <Link href={`/apps/${slug}/versions/${v.id}`} className="text-xs font-medium text-primary hover:underline">
                    Read
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="card-soft h-fit p-5">
        <h2 className="mb-1 font-semibold tracking-tight">Compare any two versions</h2>
        <p className="mb-4 text-sm text-muted-foreground">Pick an older and a newer {doc.toLowerCase()} version.</p>
        <div className="space-y-3">
          {[
            { label: "From (older)", value: from, set: setFrom },
            { label: "To (newer)", value: to, set: setTo },
          ].map((f) => (
            <label key={f.label} className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{f.label}</span>
              <Select value={f.value} onValueChange={f.set}>
                <SelectTrigger className="h-9 w-full bg-card">
                  <SelectValue placeholder="Choose a version" />
                </SelectTrigger>
                <SelectContent>
                  {clean.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {formatDate(v.version_date)} · {formatNumber(v.word_count)} words
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
          <Button className="w-full" disabled={!from || !to || from === to} onClick={() => router.push(`/apps/${slug}/compare?from=${from}&to=${to}`)}>
            <GitCompareArrows /> Compare versions
          </Button>
          <Notice>Versions flagged as capture errors (error pages, partial captures) are hidden here.</Notice>
        </div>
      </section>
    </div>
  )
}
