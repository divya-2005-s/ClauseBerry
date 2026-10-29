"use client"

import { ArrowLeft, ArrowRight, ChevronLeft, Database, FileClock, Minus, Plus, Sparkles } from "lucide-react"
import Link from "next/link"
import useSWR from "swr"

import { AnalyzerBadge, CategoryBadge, RiskBadge } from "@/components/common/badges"
import { DiffViewer } from "@/components/common/diff-viewer"
import { AiDisclaimer, Notice } from "@/components/common/page"
import { CardSkeleton, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMeta } from "@/hooks/use-meta"
import { formatDate, formatNumber } from "@/lib/format"
import type { Analysis, VersionMeta } from "@/lib/types"

type Detail = {
  change: {
    id: number
    app_name: string
    app_slug: string
    document_type: string
    previous_date: string
    change_date: string
    words_before: number
    words_after: number
    words_added: number
    words_removed: number
    added_text: string
    removed_text: string
    is_meaningful: number
    noise_reason: string | null
    detector_version: string
  }
  analysis: Analysis | null
  analyses: Analysis[]
  from_version: VersionMeta
  to_version: VersionMeta
  previous_change_id: number | null
  next_change_id: number | null
}

const DIRECTION: Record<string, string> = {
  expanded_permission: "Appears to expand what the service may do",
  reduced_permission: "Appears to narrow what the service may do",
  clarification: "Clarifies existing wording",
  editorial: "Editorial only",
  mixed: "Mixed revisions",
}

function TextPanel({ text, tone }: { text: string; tone: "add" | "remove" }) {
  if (!text.trim()) return <p className="text-sm text-muted-foreground">Nothing {tone === "add" ? "added" : "removed"}.</p>
  const lines = text.split("\n")
  return (
    <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1 text-sm leading-relaxed">
      {lines.slice(0, 400).map((l, i) => (
        <li key={i} className="flex gap-2">
          {tone === "add" ? <Plus className="mt-1 size-3.5 shrink-0 text-success" aria-hidden /> : <Minus className="mt-1 size-3.5 shrink-0 text-critical" aria-hidden />}
          <span className={tone === "remove" ? "text-muted-foreground" : ""}>{l}</span>
        </li>
      ))}
      {lines.length > 400 && <li className="text-xs text-muted-foreground">…{lines.length - 400} more lines (see the comparison tab)</li>}
    </ul>
  )
}

function Provenance({ v, label }: { v: VersionMeta; label: string }) {
  return (
    <div className="rounded-lg border p-3 text-xs">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <div className="text-muted-foreground">
        {formatDate(v.version_date)} · {formatNumber(v.word_count)} words
        <br />
        Source: {v.source === "dataset" ? "historical archive" : "fetched by ClauseBerry"} ({v.source_ref})
        {v.retrieved_at && <> · retrieved {formatDate(v.retrieved_at)}</>}
      </div>
    </div>
  )
}

export function ChangeDetail({ slug, id }: { slug: string; id: string }) {
  const { data, error, mutate } = useSWR<Detail>(`/api/changes/${id}`)
  const { categories } = useMeta()
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (!data) return <CardSkeleton lines={8} />
  const { change: c, analysis: a } = data

  return (
    <div>
      <Link href={`/apps/${slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {c.app_name}
      </Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-primary">{c.document_type} change</div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.app_name} · {formatDate(c.change_date)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compared with the version of {formatDate(c.previous_date)} · {formatNumber(c.words_before)} → {formatNumber(c.words_after)} words
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" disabled={!data.previous_change_id} className="bg-card">
            {data.previous_change_id ? (
              <Link href={`/apps/${slug}/changes/${data.previous_change_id}`}>
                <ArrowLeft /> Older
              </Link>
            ) : (
              <span aria-disabled>
                <ArrowLeft /> Older
              </span>
            )}
          </Button>
          <Button asChild variant="outline" size="sm" className="bg-card">
            {data.next_change_id ? (
              <Link href={`/apps/${slug}/changes/${data.next_change_id}`}>
                Newer <ArrowRight />
              </Link>
            ) : (
              <span aria-disabled className="pointer-events-none opacity-50">
                Newer <ArrowRight />
              </span>
            )}
          </Button>
        </div>
      </div>

      {!c.is_meaningful && (
        <Notice className="mb-5">
          This change was classified as noise (<strong>{c.noise_reason?.replaceAll("_", " ")}</strong>) and is excluded from analytics.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          {a && (
            <section className="card-soft p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <RiskBadge score={a.risk_score} />
                <CategoryBadge label={a.category_label} />
                {a.secondary_categories.map((s) => (
                  <span key={s} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {categories[s] ?? s}
                  </span>
                ))}
                <span className="flex-1" />
                <AnalyzerBadge analyzer={a.analyzer} model={a.model} />
              </div>
              <h2 className="sr-only">Summary</h2>
              <p className="text-[15px] leading-relaxed">{a.summary}</p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">Direction</dt>
                  <dd className="mt-0.5 font-medium">{DIRECTION[a.change_direction] ?? a.change_direction}</dd>
                </div>
                <div className="rounded-lg bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">Confidence</dt>
                  <dd className="mt-0.5 font-medium">
                    {a.confidence !== null ? `${Math.round(a.confidence * 100)}% (model self-reported)` : "Not reported by the rule-based analyzer"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-medium">Why this score</h3>
                <p className="text-sm text-muted-foreground">{a.reasoning}</p>
              </div>
              {a.ai_training_mentioned && a.ai_training_evidence && (
                <div className="mt-4 rounded-lg border border-[color-mix(in_oklab,var(--coral)_40%,transparent)] bg-coral-soft p-3">
                  <div className="mb-1 inline-flex items-center gap-1 text-xs font-medium">
                    <Sparkles className="size-3.5 text-coral" /> Explicit AI-training language added
                  </div>
                  <blockquote className="text-sm leading-relaxed">“{a.ai_training_evidence}”</blockquote>
                </div>
              )}
            </section>
          )}

          <section className="card-soft p-5">
            <Tabs defaultValue="diff">
              <TabsList className="mb-4">
                <TabsTrigger value="diff">Highlighted comparison</TabsTrigger>
                <TabsTrigger value="added">Added ({formatNumber(c.words_added)} words)</TabsTrigger>
                <TabsTrigger value="removed">Removed ({formatNumber(c.words_removed)} words)</TabsTrigger>
              </TabsList>
              <TabsContent value="diff">
                <DiffViewer endpoint={`/api/changes/${c.id}/diff`} />
              </TabsContent>
              <TabsContent value="added">
                <TextPanel text={c.added_text} tone="add" />
              </TabsContent>
              <TabsContent value="removed">
                <TextPanel text={c.removed_text} tone="remove" />
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card-soft space-y-3 p-5">
            <h2 className="inline-flex items-center gap-2 font-semibold tracking-tight">
              <Database className="size-4 text-primary" /> Provenance
            </h2>
            <Provenance v={data.from_version} label="Before" />
            <Provenance v={data.to_version} label="After" />
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" className="flex-1">
                <Link href={`/apps/${slug}/versions/${data.from_version.id}`}>Read before</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="flex-1">
                <Link href={`/apps/${slug}/versions/${data.to_version.id}`}>Read after</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Change detector: {c.detector_version}</p>
          </section>
          {data.analyses.length > 0 && (
            <section className="card-soft p-5">
              <h2 className="mb-3 inline-flex items-center gap-2 font-semibold tracking-tight">
                <FileClock className="size-4 text-primary" /> Analysis history
              </h2>
              <ul className="space-y-2">
                {data.analyses.map((x) => (
                  <li key={x.id}>
                    <Collapsible>
                      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-left text-xs hover:bg-muted/60">
                        <span>
                          <span className="font-medium">{x.analyzer === "llm" ? x.model : "Rule-based"}</span> · {x.prompt_version}
                          {x.is_current ? " · current" : ""}
                        </span>
                        <RiskBadge score={x.risk_score} showScore={false} />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-2.5 pt-2 text-xs text-muted-foreground">
                        {x.summary}
                        <div className="mt-1">Created {formatDate(x.created_at)}</div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <AiDisclaimer />
        </aside>
      </div>
    </div>
  )
}
