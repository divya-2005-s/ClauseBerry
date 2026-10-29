"use client"

import { Minus, Plus } from "lucide-react"
import Link from "next/link"

import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

export type AiDoc = {
  document_id: number
  document_type: string
  latest_version_id: number | null
  first_observed: Record<string, { date: string; at_coverage_start: boolean }>
  current_clauses: { kind: string; evidence: string }[]
  events: { version_id: number; version_date: string; added: { kind: string; evidence: string }[]; removed: { kind: string; evidence: string }[] }[]
  coverage_start: string | null
  coverage_end: string | null
  versions_in_archive: number | null
}

export const KIND_STYLE: Record<string, string> = {
  explicit_training: "bg-coral-soft text-foreground",
  ai_provider_sharing: "bg-secondary text-secondary-foreground",
  automated_processing: "bg-muted text-muted-foreground",
  general_ai: "bg-muted text-muted-foreground",
}

export function KindTag({ kind, labels }: { kind: string; labels: Record<string, string> }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", KIND_STYLE[kind])}>{labels[kind] ?? kind}</span>
}

export function FirstObserved({ doc }: { doc: AiDoc }) {
  const t = doc.first_observed.explicit_training
  if (!t) return <span className="text-muted-foreground">No explicit training language observed</span>
  return (
    <span>
      First observed <strong className="font-medium">{formatDate(t.date)}</strong>
      {t.at_coverage_start && (
        <span className="text-muted-foreground"> — the first archived version, so it may predate {formatDate(doc.coverage_start)}</span>
      )}
    </span>
  )
}

export function AiDocTimeline({ slug, doc, labels }: { slug: string; doc: AiDoc; labels: Record<string, string> }) {
  return (
    <div>
      <div className="mb-3 text-sm">
        <FirstObserved doc={doc} />
        <span className="text-muted-foreground">
          {" "}
          · archive coverage {formatDate(doc.coverage_start)} – {formatDate(doc.coverage_end)} ({doc.versions_in_archive} clean versions)
        </span>
      </div>
      {doc.current_clauses.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">In the latest version</h4>
          <ul className="space-y-2">
            {doc.current_clauses.map((c, i) => (
              <li key={i} className="rounded-lg border bg-card p-3 text-sm">
                <KindTag kind={c.kind} labels={labels} />
                <p className="mt-1.5 leading-relaxed">“{c.evidence}”</p>
              </li>
            ))}
          </ul>
          {doc.latest_version_id && (
            <Link href={`/apps/${slug}/versions/${doc.latest_version_id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Read the full latest {doc.document_type.toLowerCase()} →
            </Link>
          )}
        </div>
      )}
      {doc.events.length > 0 && (
        <>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">History of training & AI-provider clauses</h4>
          <ol className="relative space-y-4 border-l pl-5">
            {[...doc.events].reverse().map((e) => (
              <li key={e.version_id} className="relative">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{formatDate(e.version_date)}</span>
                  <Link href={`/apps/${slug}/versions/${e.version_id}`} className="text-xs text-primary hover:underline">
                    view version
                  </Link>
                </div>
                <ul className="mt-1.5 space-y-1.5 text-sm">
                  {e.added.map((c, i) => (
                    <li key={`a${i}`} className="flex gap-2">
                      <Plus className="mt-0.5 size-4 shrink-0 text-success" aria-label="Added" />
                      <span>
                        <KindTag kind={c.kind} labels={labels} /> <span className="leading-relaxed">“{c.evidence}”</span>
                      </span>
                    </li>
                  ))}
                  {e.removed.map((c, i) => (
                    <li key={`r${i}`} className="flex gap-2 text-muted-foreground">
                      <Minus className="mt-0.5 size-4 shrink-0 text-critical" aria-label="Removed" />
                      <span>
                        <KindTag kind={c.kind} labels={labels} /> <span className="leading-relaxed line-through decoration-critical/40">“{c.evidence}”</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
