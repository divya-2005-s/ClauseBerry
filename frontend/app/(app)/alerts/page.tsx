"use client"

import { Bell, BellOff, CheckCheck, ChevronLeft, ChevronRight, Circle, CircleDot, Settings2, Sparkles } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import useSWR, { useSWRConfig } from "swr"
import { toast } from "sonner"

import { AppAvatar } from "@/components/common/app-avatar"
import { AnalyzerBadge, CategoryBadge, RiskBadge } from "@/components/common/badges"
import { Notice, PageHeader } from "@/components/common/page"
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, qs } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

type Alert = {
  id: number
  origin: "pipeline" | "backfill"
  read_at: string | null
  created_at: string
  change_id: number
  change_date: string
  document_type: string
  app_name: string
  app_slug: string
  summary: string | null
  category: string | null
  category_label?: string
  risk_score: number | null
  ai_training_mentioned: boolean
  analyzer: string | null
}
type Alerts = { items: Alert[]; total: number; unread: number; page: number; pages: number }
type Follows = { items: { slug: string; name: string; category: string; unread_alerts: number }[]; limit: number | null }

export default function AlertsPage() {
  const [status, setStatus] = useState("all")
  const [minRisk, setMinRisk] = useState("all")
  const [app, setApp] = useState("all")
  const [page, setPage] = useState(1)
  const resetting = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const { mutate: globalMutate } = useSWRConfig()
  const key = `/api/alerts${qs({ status, min_risk: minRisk === "all" ? undefined : minRisk, app: app === "all" ? undefined : app, page, page_size: 15 })}`
  const { data, error, mutate, isLoading } = useSWR<Alerts>(key, { keepPreviousData: true })
  const { data: follows } = useSWR<Follows>("/api/me/follows")

  async function setRead(a: Alert, read: boolean) {
    try {
      await api(`/api/alerts/${a.id}/read`, { json: { read } })
      mutate()
      globalMutate("/api/alerts/unread-count")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function readAll() {
    try {
      const r = await api<{ updated: number }>("/api/alerts/read-all", { method: "POST" })
      toast.success(r.updated ? `Marked ${r.updated} alerts as read` : "Everything is already read")
      mutate()
      globalMutate("/api/alerts/unread-count")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Meaningful changes to the apps you follow. Following an app adds its changes from the last 180 days."
        actions={
          <>
            <Button variant="outline" className="h-9 bg-card" onClick={readAll} disabled={!data?.unread}>
              <CheckCheck /> Mark all read
            </Button>
            <Button asChild variant="outline" className="h-9 bg-card">
              <Link href="/settings#notifications">
                <Settings2 /> Preferences
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <ToggleGroup type="single" value={status} onValueChange={(v) => v && resetting(setStatus)(v)} variant="outline" aria-label="Read status">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="unread">Unread {data?.unread ? `(${data.unread})` : ""}</ToggleGroupItem>
              <ToggleGroupItem value="read">Read</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex gap-2 sm:ml-auto">
              <Select value={minRisk} onValueChange={resetting(setMinRisk)}>
                <SelectTrigger className="h-9 w-36 bg-card" aria-label="Minimum risk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any risk</SelectItem>
                  <SelectItem value="3">Medium+</SelectItem>
                  <SelectItem value="4">High+</SelectItem>
                  <SelectItem value="5">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Select value={app} onValueChange={resetting(setApp)}>
                <SelectTrigger className="h-9 w-40 bg-card" aria-label="Application">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All followed apps</SelectItem>
                  {follows?.items.map((f) => (
                    <SelectItem key={f.slug} value={f.slug}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            follows && follows.items.length === 0 ? (
              <EmptyState
                icon={BellOff}
                title="You're not following any apps yet"
                description="Follow an app to get an alert whenever its privacy policy or terms change meaningfully."
                action={
                  <Button asChild>
                    <Link href="/apps">Browse applications</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={Bell} title="No alerts here" description="Nothing matches these filters. New changes appear after each pipeline run." />
            )
          ) : (
            <>
              <ul className={cn("space-y-2.5", isLoading && "opacity-70")}>
                {data.items.map((a) => (
                  <li key={a.id} className={cn("card-soft flex gap-3 p-4", !a.read_at && "border-l-2 border-l-primary")}>
                    <AppAvatar name={a.app_name} className="hidden sm:grid" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/apps/${a.app_slug}/changes/${a.change_id}`} className="font-medium hover:text-primary" onClick={() => !a.read_at && setRead(a, true)}>
                          {a.app_name} updated its {a.document_type.toLowerCase()}
                        </Link>
                        {!a.read_at && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold uppercase leading-4 text-primary-foreground">New</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Changed {formatDate(a.change_date)} · {a.origin === "backfill" ? "added when you followed" : `alert ${formatDate(a.created_at)}`}
                      </div>
                      {a.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <RiskBadge score={a.risk_score} />
                        <CategoryBadge label={a.category_label} />
                        {a.ai_training_mentioned && (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-coral-soft px-2 text-xs font-medium">
                            <Sparkles className="size-3 text-coral" /> AI training
                          </span>
                        )}
                        <AnalyzerBadge analyzer={a.analyzer} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRead(a, !a.read_at)}
                      aria-label={a.read_at ? "Mark as unread" : "Mark as read"}
                      title={a.read_at ? "Mark as unread" : "Mark as read"}
                    >
                      {a.read_at ? <Circle /> : <CircleDot className="text-primary" />}
                    </Button>
                  </li>
                ))}
              </ul>
              {data.pages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                    <ChevronLeft />
                  </Button>
                  <span className="tabular-nums text-muted-foreground">
                    {data.page} / {data.pages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          <section className="card-soft p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold tracking-tight">Following</h2>
              <span className="text-xs text-muted-foreground">
                {follows?.items.length ?? 0}
                {follows?.limit ? ` / ${follows.limit}` : ""}
              </span>
            </div>
            {follows?.items.length ? (
              <ul className="space-y-1">
                {follows.items.map((f) => (
                  <li key={f.slug}>
                    <Link href={`/apps/${f.slug}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                      <span className="flex-1 truncate">{f.name}</span>
                      {f.unread_alerts > 0 && <span className="rounded-full bg-secondary px-1.5 text-xs text-secondary-foreground tabular-nums">{f.unread_alerts}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No apps followed yet.</p>
            )}
            <Button asChild variant="link" className="mt-2 h-auto px-0 text-xs">
              <Link href="/apps">Find apps to follow →</Link>
            </Button>
          </section>
          <Notice>Email alerts depend on your preferences and on the server having an email provider configured.</Notice>
        </aside>
      </div>
    </div>
  )
}
