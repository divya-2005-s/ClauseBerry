"use client"

import {
  ArrowRight,
  BellRing,
  BotMessageSquare,
  CircleCheck,
  FileSearch,
  GitCompareArrows,
  Quote,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import useSWR from "swr"

import { LogoMark } from "@/components/brand/logo"
import { RISK_LABELS, RiskBadge } from "@/components/common/badges"
import { PricingCards } from "@/components/marketing/pricing-cards"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

type PublicStats = {
  apps_tracked: number
  policy_versions: number
  raw_changes: number
  meaningful_changes: number
  high_risk_changes: number
  apps_with_training_language: number
  coverage_start: string
  coverage_end: string
  apps: string[]
  by_year: { year: string; changes: number; high_risk: number; ai_training: number }[]
  risk_distribution: { risk_score: number; changes: number }[]
  sample_change: {
    change_id: number
    app_name: string
    document_type: string
    change_date: string
    summary: string
    risk_score: number
    category_label: string
    analyzer: string
    ai_training_evidence: string | null
    reasoning: string
  } | null
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  )
}

function SampleChangeCard({ s }: { s: PublicStats["sample_change"] }) {
  if (!s) return <Skeleton className="h-72 rounded-2xl" />
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-primary/15 blur-3xl" aria-hidden />
      <article className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-lift)] sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-secondary text-sm font-semibold text-primary">{s.app_name.slice(0, 2)}</span>
            <div>
              <div className="text-sm font-semibold">{s.app_name}</div>
              <div className="text-xs text-muted-foreground">
                {s.document_type} · {formatDate(s.change_date)}
              </div>
            </div>
          </div>
          <RiskBadge score={s.risk_score} />
        </div>
        <p className="text-sm leading-relaxed">{s.summary.split(' New text includes:')[0]}</p>
        {s.ai_training_evidence && (
          <div className="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--coral)_40%,transparent)] bg-coral-soft p-3.5">
            <div className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium">
              <Sparkles className="size-3.5 text-coral" /> New AI-training language
            </div>
            <p className="line-clamp-4 text-sm leading-relaxed">
              <Quote className="mr-1 inline size-3.5 -translate-y-0.5 text-muted-foreground" aria-hidden />
              {s.ai_training_evidence}
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{s.category_label}</span>
          <span>Real change from the archive · {s.analyzer === "llm" ? "AI summary" : "rule-based analysis"}</span>
        </div>
      </article>
    </div>
  )
}

function YearBars({ data }: { data: PublicStats["by_year"] }) {
  const max = Math.max(1, ...data.map((d) => d.changes))
  return (
    <div className="flex h-40 items-end gap-3" role="img" aria-label={`Meaningful changes per year: ${data.map((d) => `${d.year} ${d.changes}`).join(", ")}`}>
      {data.map((d) => (
        <div key={d.year} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="text-xs text-muted-foreground tabular-nums">{d.changes}</span>
          <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: `${(d.changes / max) * 110}px` }}>
            <div style={{ height: `${(d.high_risk / d.changes) * 100}%`, background: "var(--risk-5)" }} />
            <div className="flex-1" style={{ background: "var(--chart-1)", opacity: 0.85 }} />
          </div>
          <span className="text-xs text-muted-foreground">{d.year}</span>
        </div>
      ))}
    </div>
  )
}

const FEATURES = [
  { icon: GitCompareArrows, title: "Every change, highlighted", text: "Word-level comparisons between policy versions, with formatting noise and capture glitches filtered out." },
  { icon: TrendingUp, title: "Plain-English risk scores", text: "Each meaningful change gets a summary, a category and a 1–5 score with the reasoning behind it." },
  { icon: Sparkles, title: "AI-training clause tracking", text: "Sentence-level evidence separating explicit model-training language from general AI mentions." },
  { icon: BotMessageSquare, title: "Ask with citations", text: "Questions are answered from retrieved policy passages — every claim links back to its source." },
  { icon: BellRing, title: "Alerts that matter", text: "Follow apps and get notified about changes above the risk level you choose." },
  { icon: FileSearch, title: "Full provenance", text: "Archived source, capture dates and analyzer versions are kept with every result." },
]

const FAQ = [
  { q: "Where does the data come from?", a: "The historical policies come from the Platform Governance Archive, collected with Open Terms Archive and licensed under ODbL. ClauseBerry can also fetch current policy pages on a daily schedule, respecting robots.txt." },
  { q: "Is ClauseBerry legal advice?", a: "No. Summaries and scores are automated estimates to help you decide what to read. Always check the quoted source text, and consult a lawyer for legal questions." },
  { q: "How is the risk score calculated?", a: "A documented 1–5 rubric judges the impact of the change itself — e.g. new sharing or AI training permissions score higher than wording clarifications. The reasoning is shown for every score." },
  { q: "Does 'mentions AI' mean my data trains AI?", a: "No. ClauseBerry separates explicit training language from general AI mentions and from permission to process data, and never treats one as the other." },
  { q: "Why might the 'first observed' date be wrong?", a: "The archive starts at different dates for each app, so a clause first seen in the earliest archived version may be older. ClauseBerry labels those cases." },
  { q: "What data do you keep about me?", a: "Your account details, followed apps, alerts, preferences and chat history. You can delete everything from Settings at any time." },
]

export default function LandingPage() {
  const { data } = useSWR<PublicStats>("/api/public/stats")
  const maxRisk = Math.max(1, ...(data?.risk_distribution.map((r) => r.changes) ?? [1]))

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-berry-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(60%_60%_at_50%_20%,black,transparent)]" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-[var(--shadow-soft)]">
              <ShieldCheck className="size-3.5 text-primary" /> AI privacy intelligence
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Know what you agreed to.{" "}
              <span className="bg-gradient-to-r from-primary to-[color-mix(in_oklab,var(--primary)_55%,var(--coral))] bg-clip-text text-transparent">
                Stay ahead of what changes.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Your apps change their rules. ClauseBerry tracks their privacy policies and terms, explains every meaningful change in plain
              English and shows you exactly where AI-training language appears.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="h-11 px-5 text-base">
                <Link href="/sign-up">
                  Get started free <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 bg-card px-5 text-base">
                <Link href="#how">See how it works</Link>
              </Button>
            </div>
            <div className="mt-10 grid max-w-lg grid-cols-3 gap-6">
              {data ? (
                <>
                  <Stat value={data.apps_tracked} label="apps tracked" />
                  <Stat value={formatNumber(data.policy_versions)} label="policy versions" />
                  <Stat value={formatNumber(data.meaningful_changes)} label="meaningful changes" />
                </>
              ) : (
                [0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)
              )}
            </div>
            {data && (
              <p className="mt-3 text-xs text-muted-foreground">
                Archive coverage {formatDate(data.coverage_start)} – {formatDate(data.coverage_end)}. Live figures from the ClauseBerry database.
              </p>
            )}
          </div>
          <SampleChangeCard s={data?.sample_change ?? null} />
        </div>
      </section>

      {/* Logos strip */}
      <section className="border-y bg-surface-2">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <p className="mb-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">Policies archived for</p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-medium text-muted-foreground">
            {(data?.apps ?? []).map((a) => (
              <span key={a}>{a}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-medium text-primary">Features</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Built to make fine print legible</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card-soft p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-lavender">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-sm font-medium text-primary">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">From a wall of legal text to three lines you can act on</h2>
          </div>
          <ol className="grid gap-5 md:grid-cols-4">
            {[
              { icon: ScanSearch, t: "Capture", d: "Policy versions from the archive and daily, polite fetches of public policy pages." },
              { icon: GitCompareArrows, t: "Compare", d: "Normalised diffs drop formatting noise, reverts and broken captures." },
              { icon: TrendingUp, t: "Explain", d: "Each meaningful change is summarised, categorised and scored with reasons." },
              { icon: BellRing, t: "Alert", d: "Followers are notified, and every answer links back to the source text." },
            ].map((s, i) => (
              <li key={s.t} className="card-soft relative p-5">
                <span className="text-xs font-semibold text-primary">0{i + 1}</span>
                <s.icon className="mt-3 size-6 text-primary" />
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* AI training */}
      <section id="ai-training" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-coral">AI-training tracker</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">See when “we may use your data to train AI” shows up</h2>
          <p className="mt-4 text-muted-foreground">
            ClauseBerry reads every archived version sentence by sentence and keeps the exact wording. It distinguishes four kinds of language, so
            a passing mention of “AI features” is never mistaken for permission to train models on your posts.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              ["Explicit model-training language", "e.g. using personal data to develop and train AI models"],
              ["Sharing with AI providers", "data sent to third-party model or AI service providers"],
              ["Automated processing", "machine learning, profiling and automated decisions"],
              ["General AI mentions", "AI features and assistants, with no training claim"],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <strong className="font-medium">{t}</strong> <span className="text-muted-foreground">— {d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card-soft p-6">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight tabular-nums">{data?.apps_with_training_language ?? "—"}</span>
            <span className="text-muted-foreground">of {data?.apps_tracked ?? "—"} apps</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">have explicit training language in their latest archived privacy policy or terms.</p>
          <div className="mt-6 space-y-2">
            {(data?.by_year ?? []).map((y) => (
              <div key={y.year} className="flex items-center gap-3 text-sm">
                <span className="w-10 text-muted-foreground">{y.year}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-coral" style={{ width: `${Math.min(100, (y.ai_training / Math.max(1, ...data!.by_year.map((x) => x.ai_training))) * 100)}%` }} />
                </span>
                <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">{y.ai_training} changes</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Meaningful changes per year that add explicit AI-training wording (from the database).</p>
        </div>
      </section>

      {/* Analytics preview */}
      <section className="border-y bg-surface-2">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="text-sm font-medium text-primary">Privacy risk analytics</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">The big picture, from real policy history</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="card-soft p-6">
              <div className="mb-1 font-semibold">Meaningful changes per year</div>
              <p className="mb-5 text-sm text-muted-foreground">
                <span className="mr-3 inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: "var(--chart-1)" }} /> all
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: "var(--risk-5)" }} /> high or critical
                </span>
              </p>
              {data ? <YearBars data={data.by_year} /> : <Skeleton className="h-40" />}
            </div>
            <div className="card-soft p-6">
              <div className="mb-4 font-semibold">How risky were they?</div>
              <ul className="space-y-3">
                {(data?.risk_distribution ?? []).map((r) => (
                  <li key={r.risk_score} className="flex items-center gap-3 text-sm">
                    <span className="w-16 text-muted-foreground">{RISK_LABELS[r.risk_score]}</span>
                    <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.changes / maxRisk) * 100}%`, background: `var(--risk-${r.risk_score})` }} />
                    </span>
                    <span className="w-10 text-right tabular-nums">{r.changes}</span>
                  </li>
                ))}
              </ul>
              {data && (
                <p className="mt-5 text-xs text-muted-foreground">
                  {formatNumber(data.meaningful_changes)} meaningful changes out of {formatNumber(data.raw_changes)} raw diffs — the rest were formatting noise,
                  reverts or broken captures.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-medium text-primary">Pricing</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Free while you&apos;re getting started</h2>
        </div>
        <PricingCards />
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-lavender">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 className="mb-8 text-center text-3xl font-semibold tracking-tight">Questions, answered</h2>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <Collapsible key={f.q} className="card-soft">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 p-4 text-left font-medium">
                  {f.q}
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4 text-sm text-muted-foreground">{f.a}</CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className={cn("relative overflow-hidden rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12")}>
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <LogoMark className="mx-auto size-12" />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">Your privacy deserves a closer look</h2>
          <p className="mx-auto mt-3 max-w-xl opacity-90">Follow three apps for free and get plain-English alerts when their rules change.</p>
          <Button asChild variant="secondary" className="mt-7 h-11 px-6 text-base">
            <Link href="/sign-up">
              Create your free account <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}
