"use client"

import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"

import { DiffViewer } from "@/components/common/diff-viewer"
import { PageHeader } from "@/components/common/page"
import { EmptyState } from "@/components/common/states"
import { GitCompareArrows } from "lucide-react"

export function CompareView() {
  const { slug } = useParams<{ slug: string }>()
  const sp = useSearchParams()
  const from = sp.get("from")
  const to = sp.get("to")
  return (
    <div>
      <Link href={`/apps/${slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Back to app
      </Link>
      <PageHeader title="Version comparison" description="Additions are highlighted in green, removals struck through in red, edits in amber." />
      {from && to ? (
        <section className="card-soft p-5">
          <DiffViewer endpoint={`/api/compare?from_version=${encodeURIComponent(from)}&to_version=${encodeURIComponent(to)}`} />
        </section>
      ) : (
        <EmptyState icon={GitCompareArrows} title="Choose two versions" description="Open the Versions tab on an app page to pick versions to compare." />
      )}
    </div>
  )
}
