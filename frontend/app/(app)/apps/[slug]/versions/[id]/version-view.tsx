"use client"

import { ChevronLeft, Sparkles, TriangleAlert } from "lucide-react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import useSWR from "swr"

import { KindTag } from "@/components/common/ai-evidence"
import { Notice } from "@/components/common/page"
import { CardSkeleton, ErrorState } from "@/components/common/states"
import { useMeta } from "@/hooks/use-meta"
import { formatDate, formatNumber } from "@/lib/format"
import type { VersionMeta } from "@/lib/types"

type Version = VersionMeta & { text: string; ai_clauses: { kind: string; evidence: string }[] }

export function VersionView({ slug, id }: { slug: string; id: string }) {
  const { data, error, mutate } = useSWR<Version>(`/api/versions/${id}`)
  const { aiKinds } = useMeta()
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (!data) return <CardSkeleton lines={10} />
  const flagged = data.ai_clauses.filter((c) => c.kind === "explicit_training" || c.kind === "ai_provider_sharing")

  return (
    <div>
      <Link href={`/apps/${slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {data.app_name}
      </Link>
      <div className="mb-5">
        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-primary">{data.document_type}</div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.app_name} · version of {formatDate(data.version_date)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatNumber(data.word_count)} words · {data.source === "dataset" ? "historical archive" : "fetched by ClauseBerry"} ({data.source_ref})
        </p>
      </div>
      {data.quality_flag !== "ok" && (
        <Notice icon={TriangleAlert} className="mb-5">
          This capture looks like an error page or partial capture, so it is excluded from change detection and analytics.
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <article className="card-soft min-w-0 p-5 sm:p-8">
          <div className="prose-chat max-w-none text-sm leading-relaxed [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-medium [&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:p-1.5 [&_th]:border [&_th]:p-1.5">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: () => null,
                a: ({ children, href }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                    {children}
                  </a>
                ),
              }}
            >
              {data.text}
            </ReactMarkdown>
          </div>
        </article>
        <aside className="h-fit space-y-3 lg:sticky lg:top-20">
          <section className="card-soft p-5">
            <h2 className="mb-1 inline-flex items-center gap-2 font-semibold tracking-tight">
              <Sparkles className="size-4 text-coral" /> AI-related clauses
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {data.ai_clauses.length} AI-related sentences detected; {flagged.length} concern training or AI providers.
            </p>
            {flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">No explicit training or AI-provider language in this version.</p>
            ) : (
              <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {flagged.map((c, i) => (
                  <li key={i} className="rounded-lg border p-2.5 text-xs leading-relaxed">
                    <KindTag kind={c.kind} labels={aiKinds} />
                    <p className="mt-1">“{c.evidence}”</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="px-1 text-xs text-muted-foreground">
            Policy text © its publisher, archived by Open Terms Archive / Platform Governance Archive. Images and external content are not loaded.
          </p>
        </aside>
      </div>
    </div>
  )
}
