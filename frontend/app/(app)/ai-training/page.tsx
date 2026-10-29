"use client"

import { Bot, ChevronDown, Sparkles } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import useSWR from "swr"

import { AiDocTimeline, FirstObserved, KindTag, type AiDoc } from "@/components/common/ai-evidence"
import { AppAvatar } from "@/components/common/app-avatar"
import { AiStatusBadge } from "@/components/common/badges"
import { DateRangeSelect, dateRangePresets, type DateRange } from "@/components/common/date-range"
import { Notice, PageHeader } from "@/components/common/page"
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMeta } from "@/hooks/use-meta"
import { qs } from "@/lib/api"
import type { AiStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

type TrackerApp = { app_slug: string; app_name: string; status: AiStatus | null; kinds: Record<string, { first_seen: string; versions: number }>; documents: AiDoc[] }
type Tracker = { apps: TrackerApp[]; summary: Record<string, number>; kinds: Record<string, string>; caveat: string }

const SUMMARY: { key: AiStatus["status"]; label: string; hint: string }[] = [
  { key: "explicit_training", label: "Explicit training language", hint: "in the latest version" },
  { key: "training_removed", label: "Training language removed", hint: "present earlier, not now" },
  { key: "ai_provider_sharing", label: "AI-provider sharing only", hint: "no explicit training text" },
  { key: "general_ai", label: "General AI mentions", hint: "no training or provider text" },
]

export default function AiTrainingPage() {
  const presets = useMemo(() => dateRangePresets(2022), [])
  const [range, setRange] = useState<DateRange>(presets[0])
  const [app, setApp] = useState("all")
  const [status, setStatus] = useState<string>("all")
  const { aiKinds } = useMeta()
  const { data, error, mutate, isLoading } = useSWR<Tracker>(
    `/api/ai-training${qs({ date_from: range.from, date_to: range.to, app: app === "all" ? undefined : app })}`,
    { keepPreviousData: true },
  )
  const { data: all } = useSWR<Tracker>("/api/ai-training")
  const apps = (data?.apps ?? []).filter((a) => status === "all" || a.status?.status === status)

  return (
    <div>
      <PageHeader
        eyebrow="AI-training tracker"
        title="Who says what about training AI on your data"
        description="Sentence-level evidence from every archived version, separating explicit model-training language from general AI mentions."
        actions={
          <>
            <Select value={app} onValueChange={setApp}>
              <SelectTrigger className="h-9 w-44 bg-card" aria-label="Application">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All applications</SelectItem>
                {(all?.apps ?? [])
                  .slice()
                  .sort((a, b) => a.app_name.localeCompare(b.app_name))
                  .map((a) => (
                    <SelectItem key={a.app_slug} value={a.app_slug}>
                      {a.app_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <DateRangeSelect value={range.key} presets={presets} onChange={setRange} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SUMMARY.map((s) => {
          const active = status === s.key
          return (
            <button
              key={s.key}
              onClick={() => setStatus(active ? "all" : s.key)}
              aria-pressed={active}
              className={cn("card-soft p-4 text-left transition-shadow hover:shadow-[var(--shadow-lift)]", active && "ring-2 ring-primary")}
            >
              <div className="text-2xl font-semibold tabular-nums">{all ? (all.summary[s.key] ?? 0) : "—"}</div>
              <div className="mt-1 text-sm font-medium">{s.label}</div>
              <div className="text-xs text-muted-foreground">{s.hint}</div>
            </button>
          )
        })}
      </div>

      <Notice className="mb-5">
        {data?.caveat ??
          "Detection is sentence-level pattern matching. Mentioning AI is not evidence that user data trains models; permission to process data is not confirmed training."}{" "}
        Kinds: {Object.values(aiKinds).join(" · ")}.
      </Notice>

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <CardSkeleton key={i} lines={3} />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState icon={Bot} title="Nothing in this selection" description="No training or AI-provider clauses were captured for these filters." />
      ) : (
        <ul className={cn("space-y-3", isLoading && "opacity-70")}>
          {apps.map((a) => {
            const docsWithEvidence = a.documents.filter((d) => d.events.length || d.current_clauses.length)
            return (
              <li key={a.app_slug}>
                <Collapsible className="card-soft">
                  <CollapsibleTrigger className="group flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <AppAvatar name={a.app_name} />
                      <div className="min-w-0">
                        <div className="font-semibold">{a.app_name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {docsWithEvidence.length ? (
                            docsWithEvidence.map((d) => (
                              <span key={d.document_id} className="mr-3 inline-block">
                                {d.document_type}: <FirstObserved doc={d} />
                              </span>
                            ))
                          ) : (
                            "No explicit training or AI-provider clauses in this range"
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {Object.keys(a.kinds)
                        .filter((k) => k === "explicit_training" || k === "ai_provider_sharing")
                        .map((k) => (
                          <KindTag key={k} kind={k} labels={aiKinds} />
                        ))}
                      <AiStatusBadge status={a.status} compact />
                      <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 pt-4 pb-5">
                    {docsWithEvidence.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Only general AI or automated-processing language was found.</p>
                    ) : (
                      <div className="grid gap-6 xl:grid-cols-2">
                        {docsWithEvidence.map((d) => (
                          <div key={d.document_id}>
                            <h3 className="mb-2 inline-flex items-center gap-2 font-medium">
                              <Sparkles className="size-4 text-coral" /> {d.document_type}
                            </h3>
                            <AiDocTimeline slug={a.app_slug} doc={d} labels={aiKinds} />
                          </div>
                        ))}
                      </div>
                    )}
                    <Link href={`/apps/${a.app_slug}`} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                      Open {a.app_name} →
                    </Link>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
