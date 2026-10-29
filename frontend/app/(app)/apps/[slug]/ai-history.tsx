"use client"

import { Bot } from "lucide-react"
import useSWR from "swr"

import { AiDocTimeline, type AiDoc } from "@/components/common/ai-evidence"
import { Notice } from "@/components/common/page"
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/states"
import { useMeta } from "@/hooks/use-meta"

type Tracker = { apps: { app_slug: string; documents: AiDoc[] }[]; caveat: string }

export function AiHistory({ slug }: { slug: string }) {
  const { data, error, mutate } = useSWR<Tracker>(`/api/ai-training?app=${slug}`)
  const { aiKinds } = useMeta()
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (!data) return <CardSkeleton lines={5} />
  const docs = data.apps.find((a) => a.app_slug === slug)?.documents ?? []
  return (
    <div className="space-y-5">
      <Notice>{data.caveat}</Notice>
      {docs.length === 0 ? (
        <EmptyState icon={Bot} title="No training or AI-provider clauses found" description="No archived version of this app's documents contains explicit model-training or AI-provider sharing language." />
      ) : (
        docs.map((d) => (
          <section key={d.document_id} className="card-soft p-5">
            <h3 className="mb-3 font-semibold">{d.document_type}</h3>
            <AiDocTimeline slug={slug} doc={d} labels={aiKinds} />
          </section>
        ))
      )}
    </div>
  )
}
