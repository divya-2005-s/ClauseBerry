"use client"

import { ArrowRight, ChevronLeft, ChevronRight, LayoutGrid, Search, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import useSWR from "swr"

import { AppAvatar } from "@/components/common/app-avatar"
import { AiStatusBadge, RiskBadge } from "@/components/common/badges"
import { FollowButton } from "@/components/common/follow-button"
import { PageHeader } from "@/components/common/page"
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDebounce } from "@/hooks/use-debounce"
import { qs } from "@/lib/api"
import { formatDate } from "@/lib/format"
import type { AppSummary, Paged } from "@/lib/types"

type Directory = Paged<AppSummary> & { categories: string[] }

const ANY = "any"

export default function AppsPage() {
  const [q, setQ] = useState("")
  const [category, setCategory] = useState(ANY)
  const [risk, setRisk] = useState(ANY)
  const [ai, setAi] = useState(ANY)
  const [sort, setSort] = useState("name")
  const [page, setPage] = useState(1)
  const dq = useDebounce(q, 250)

  const resetting = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  const key = `/api/apps${qs({
    q: dq,
    category: category === ANY ? undefined : category,
    risk: risk === ANY ? undefined : risk,
    ai: ai === ANY ? undefined : ai === "any_ai" ? "any" : ai,
    sort,
    page,
    page_size: 12,
  })}`
  const { data, error, isLoading, mutate } = useSWR<Directory>(key, { keepPreviousData: true })
  const filtered = dq || category !== ANY || risk !== ANY || ai !== ANY

  function reset() {
    setPage(1)
    setQ("")
    setCategory(ANY)
    setRisk(ANY)
    setAi(ANY)
  }

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Every service in the archive, with its latest policy date, assessed risk and AI-training language status."
      />

      <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => resetting(setQ)(e.target.value)}
            placeholder="Search apps or categories…"
            aria-label="Search applications"
            className="h-9 bg-card pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={category} onValueChange={resetting(setCategory)}>
            <SelectTrigger className="h-9 bg-card sm:w-44" aria-label="Category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All categories</SelectItem>
              {data?.categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={resetting(setRisk)}>
            <SelectTrigger className="h-9 bg-card sm:w-40" aria-label="Latest risk">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any latest risk</SelectItem>
              <SelectItem value="high">High (4–5)</SelectItem>
              <SelectItem value="medium">Medium (3)</SelectItem>
              <SelectItem value="low">Low (1–2)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ai} onValueChange={resetting(setAi)}>
            <SelectTrigger className="h-9 bg-card sm:w-48" aria-label="AI language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any AI status</SelectItem>
              <SelectItem value="explicit_training">Explicit training language</SelectItem>
              <SelectItem value="any_ai">Any AI language</SelectItem>
              <SelectItem value="none">No AI language</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={resetting(setSort)}>
            <SelectTrigger className="h-9 bg-card sm:w-40" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort: Name</SelectItem>
              <SelectItem value="risk">Sort: Avg risk</SelectItem>
              <SelectItem value="changes">Sort: Most changes</SelectItem>
              <SelectItem value="latest">Sort: Recently updated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} lines={4} />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No apps match these filters"
          description="Try a different search or clear the filters."
          action={
            <Button variant="outline" onClick={reset}>
              <X /> Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {data.total} {data.total === 1 ? "app" : "apps"}
            {filtered && " match your filters"}
          </p>
          <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${isLoading ? "opacity-70" : ""}`}>
            {data.items.map((app) => (
              <div
                key={app.slug}
                className="card-soft group relative flex flex-col p-4 transition-shadow focus-within:shadow-[var(--shadow-lift)] hover:shadow-[var(--shadow-lift)]"
              >
                <div className="flex items-start gap-3">
                  <AppAvatar name={app.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-semibold group-hover:text-primary">
                        <Link href={`/apps/${app.slug}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
                          {app.name}
                        </Link>
                      </h3>
                    </div>
                    <p className="text-xs text-muted-foreground">{app.category}</p>
                  </div>
                  <FollowButton
                    className="relative z-10"
                    slug={app.slug}
                    name={app.name}
                    following={app.following}
                    onChange={() => mutate()}
                  />
                </div>
                <div className="relative z-10 mt-4 flex w-fit flex-wrap gap-1.5">
                  <RiskBadge score={app.latest_risk_score} />
                  <AiStatusBadge status={app.ai_status} compact />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Latest policy</dt>
                    <dd className="mt-0.5 font-medium">{formatDate(app.latest_policy_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Changes</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">{app.meaningful_changes}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Avg risk</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">{app.avg_risk_score?.toFixed(1) ?? "—"}</dd>
                  </div>
                </dl>
                {app.note && <p className="mt-3 text-xs text-muted-foreground">{app.note}</p>}
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  View details <ArrowRight className="size-3" />
                </span>
              </div>
            ))}
          </div>
          {data.pages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft /> Previous
              </Button>
              <span className="px-2 text-sm text-muted-foreground tabular-nums">
                Page {data.page} of {data.pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
