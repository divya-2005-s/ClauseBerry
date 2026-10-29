"use client"

import { Columns2, Minus, Plus, Rows3, SquarePen } from "lucide-react"
import { useState } from "react"
import useSWR from "swr"

import { ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/format"
import type { DiffBlock, VersionMeta } from "@/lib/types"
import { cn } from "@/lib/utils"

type DiffResponse = { from_version: VersionMeta; to_version: VersionMeta; stats: { added: number; removed: number; modified: number }; blocks: DiffBlock[] }

function Lines({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split("\n").map((l, i) => (
        <p key={i} className={cn("py-0.5", className)}>
          {l}
        </p>
      ))}
    </>
  )
}

function Inline({ block }: { block: DiffBlock }) {
  switch (block.type) {
    case "skip":
      return (
        <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {block.lines} unchanged {block.lines === 1 ? "paragraph" : "paragraphs"}
          <span className="h-px flex-1 bg-border" />
        </div>
      )
    case "equal":
      return <Lines text={block.new} className="text-muted-foreground" />
    case "added":
      return (
        <div className="my-1 rounded-md border-l-2 border-success bg-[color-mix(in_oklab,var(--success)_8%,transparent)] px-3 py-1">
          <span className="sr-only">Added: </span>
          <Lines text={block.new} />
        </div>
      )
    case "removed":
      return (
        <div className="my-1 rounded-md border-l-2 border-critical bg-[color-mix(in_oklab,var(--critical)_7%,transparent)] px-3 py-1 text-muted-foreground line-through decoration-critical/40">
          <span className="sr-only">Removed: </span>
          <Lines text={block.old} />
        </div>
      )
    case "modified":
      return (
        <div className="my-1 rounded-md border-l-2 border-warning bg-[color-mix(in_oklab,var(--warning)_7%,transparent)] px-3 py-1 whitespace-pre-wrap">
          <span className="sr-only">Modified: </span>
          {block.words.map((w, i) =>
            w.op === "equal" ? (
              <span key={i}>{w.text}</span>
            ) : w.op === "insert" ? (
              <ins key={i} className="diff-ins">
                {w.text}
              </ins>
            ) : (
              <del key={i} className="diff-del">
                {w.text}
              </del>
            ),
          )}
        </div>
      )
  }
}

function SideBySide({ blocks }: { blocks: DiffBlock[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 text-sm">
      <div className="sticky top-14 z-10 border-b bg-card pb-1 text-xs font-medium text-muted-foreground">Before</div>
      <div className="sticky top-14 z-10 border-b bg-card pb-1 text-xs font-medium text-muted-foreground">After</div>
      {blocks.map((b, i) =>
        b.type === "skip" ? (
          <div key={i} className="col-span-2 my-2 text-center text-xs text-muted-foreground">
            · · · {b.lines} unchanged · · ·
          </div>
        ) : (
          <div key={i} className="contents">
            <div className={cn("py-1", b.type === "removed" || b.type === "modified" ? "rounded bg-[color-mix(in_oklab,var(--critical)_7%,transparent)] px-2" : "text-muted-foreground")}>
              {b.type === "modified"
                ? b.words.filter((w) => w.op !== "insert").map((w, j) => (w.op === "delete" ? <del key={j} className="diff-del">{w.text}</del> : <span key={j}>{w.text}</span>))
                : b.old && <Lines text={b.old} />}
            </div>
            <div className={cn("py-1", b.type === "added" || b.type === "modified" ? "rounded bg-[color-mix(in_oklab,var(--success)_8%,transparent)] px-2" : "text-muted-foreground")}>
              {b.type === "modified"
                ? b.words.filter((w) => w.op !== "delete").map((w, j) => (w.op === "insert" ? <ins key={j} className="diff-ins">{w.text}</ins> : <span key={j}>{w.text}</span>))
                : b.new && <Lines text={b.new} />}
            </div>
          </div>
        ),
      )}
    </div>
  )
}

export function DiffViewer({ endpoint }: { endpoint: string }) {
  const [full, setFull] = useState(false)
  const [mode, setMode] = useState<"inline" | "split">("inline")
  const { data, error, isLoading, mutate } = useSWR<DiffResponse>(`${endpoint}${endpoint.includes("?") ? "&" : "?"}full=${full}`, { keepPreviousData: true })

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (!data)
    return (
      <div className="space-y-2" aria-busy>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${60 + ((i * 13) % 40)}%` }} />
        ))}
      </div>
    )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <Plus className="size-3.5 text-success" /> {data.stats.added} added
          </span>
          <span className="inline-flex items-center gap-1">
            <Minus className="size-3.5 text-critical" /> {data.stats.removed} removed
          </span>
          <span className="inline-flex items-center gap-1">
            <SquarePen className="size-3.5 text-warning" /> {data.stats.modified} modified
          </span>
          <span className="text-muted-foreground">
            {formatDate(data.from_version.version_date)} → {formatDate(data.to_version.version_date)}
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <div className="hidden rounded-lg border p-0.5 md:flex" role="group" aria-label="Diff layout">
            <button aria-pressed={mode === "inline"} onClick={() => setMode("inline")} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs", mode === "inline" && "bg-secondary text-secondary-foreground")}>
              <Rows3 className="size-3.5" /> Inline
            </button>
            <button aria-pressed={mode === "split"} onClick={() => setMode("split")} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs", mode === "split" && "bg-secondary text-secondary-foreground")}>
              <Columns2 className="size-3.5" /> Side by side
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFull((f) => !f)} disabled={isLoading}>
            {full ? "Collapse unchanged" : "Show full document"}
          </Button>
        </div>
      </div>
      <div className={cn("text-sm leading-relaxed", isLoading && "opacity-60")}>
        {mode === "split" ? <SideBySide blocks={data.blocks} /> : data.blocks.map((b, i) => <Inline key={i} block={b} />)}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Text is normalised before comparison (links, images, markup and whitespace removed), so formatting-only differences are hidden.
      </p>
    </div>
  )
}
