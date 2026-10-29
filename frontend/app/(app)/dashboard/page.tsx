"use client"

import { Activity, AppWindow, Download, FileStack, Gauge, ShieldAlert, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import useSWR from "swr"

import {
  AiTimelineChart,
  CategoryChart,
  CategoryHeatmap,
  ChangesTimelineChart,
  PolicyLengthChart,
  RankingList,
  RiskDistributionChart,
} from "@/components/charts/dashboard-charts"
import { DateRangeSelect, dateRangePresets, type DateRange } from "@/components/common/date-range"
import { AiDisclaimer, KpiCard, PageHeader } from "@/components/common/page"
import { ChartSkeleton, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { qs } from "@/lib/api"
import { formatDate, formatNumber, relativeTime } from "@/lib/format"

type Dashboard = {
  kpis: {
    apps_tracked: number
    policy_versions: number
    raw_changes: number
    meaningful_changes: number
    high_risk_changes: number
    avg_risk_score: number | null
    ai_training_changes: number
  }
  timeline: { period: string; changes: number; high_risk: number; medium_risk: number; low_risk: number }[]
  risk_distribution: { risk_score: number; risk_level: string; changes: number }[]
  categories: { category: string; label: string; changes: number; avg_risk: number }[]
  rankings: { app_name: string; app_slug: string; app_category: string; changes: number; avg_risk: number; high_risk: number; max_risk: number }[]
  heatmap: { apps: string[]; categories: string[]; category_labels: Record<string, string>; cells: { app_name: string; app_slug: string; category: string; changes: number }[] }
  ai_timeline: { period: string; explicit_training: number; ai_provider_sharing: number; any_ai: number }[]
  policy_length: { period: string; privacy_policy: number | null; terms_of_service: number | null }[]
  coverage: {
    first_version_date: string
    last_version_date: string
    analyzers: Record<string, number>
    pipeline: Record<string, { status: string; finished_at: string }>
    last_fetch_at: string | null
  }
}

export default function DashboardPage() {
  const { user } = useAuth()
  const presets = useMemo(() => dateRangePresets(2022), [])
  const [range, setRange] = useState<DateRange>(presets[0])
  const { data, error, isLoading, mutate } = useSWR<Dashboard>(`/api/dashboard${qs({ date_from: range.from, date_to: range.to })}`, {
    keepPreviousData: true,
  })
  const k = data?.kpis
  const lastUpdate = data?.coverage.pipeline?.analyze?.finished_at ?? data?.coverage.pipeline?.load_db?.finished_at

  return (
    <div>
      <PageHeader
        eyebrow={`Hi ${user?.name.split(" ")[0] ?? "there"}`}
        title="Privacy intelligence overview"
        description={
          data ? (
            <>
              Archive coverage {formatDate(data.coverage.first_version_date)} – {formatDate(data.coverage.last_version_date)} · data last
              processed {relativeTime(lastUpdate)}.
            </>
          ) : (
            "Loading coverage…"
          )
        }
        actions={
          <>
            <DateRangeSelect value={range.key} presets={presets} onChange={setRange} />
            <Button asChild variant="outline" className="h-9 bg-card">
              <a href={`/api/exports/changes.csv${qs({ date_from: range.from, date_to: range.to })}`}>
                <Download /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {!k ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
            ) : (
              <>
                <KpiCard label="Applications tracked" value={formatNumber(k.apps_tracked)} icon={AppWindow} hint="Privacy policy + terms each" />
                <KpiCard label="Policy versions" value={formatNumber(k.policy_versions)} icon={FileStack} hint={range.key === "all" ? "All archived captures" : "Captured in range"} />
                <KpiCard
                  label="Meaningful changes"
                  value={formatNumber(k.meaningful_changes)}
                  icon={Activity}
                  hint={`of ${formatNumber(k.raw_changes)} raw diffs (noise filtered)`}
                />
                <KpiCard label="High-risk changes" value={formatNumber(k.high_risk_changes)} icon={ShieldAlert} tone="coral" hint="Scored 4 or 5" />
                <KpiCard
                  label="Average risk score"
                  value={k.avg_risk_score !== null ? `${k.avg_risk_score.toFixed(2)}` : "—"}
                  icon={Gauge}
                  tone="neutral"
                  hint={
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="size-3 text-coral" /> {k.ai_training_changes} add AI-training language
                    </span>
                  }
                />
              </>
            )}
          </div>

          {isLoading && !data ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
            </div>
          ) : data ? (
            <div className={isLoading ? "opacity-70 transition-opacity" : "transition-opacity"}>
              <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
                <ChangesTimelineChart data={data.timeline} />
                <RiskDistributionChart data={data.risk_distribution} />
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <CategoryChart data={data.categories} />
                <RankingList data={data.rankings} />
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <AiTimelineChart data={data.ai_timeline} />
                <PolicyLengthChart data={data.policy_length} />
              </div>
              <div className="mt-5">
                <CategoryHeatmap data={data.heatmap} />
              </div>
              <div className="mt-5 flex flex-col gap-1">
                <AiDisclaimer />
                <p className="text-xs text-muted-foreground">
                  Analysis source:{" "}
                  {Object.entries(data.coverage.analyzers)
                    .map(([a, n]) => `${n} ${a === "llm" ? "LLM" : "rule-based"}`)
                    .join(", ") || "none yet"}
                  . Data: Open Terms Archive contributors / Platform Governance Archive (ODbL).
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
