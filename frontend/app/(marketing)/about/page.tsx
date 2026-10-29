import type { Metadata } from "next"

export const metadata: Metadata = { title: "About & data sources" }

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-primary">About</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Why ClauseBerry exists</h1>
      <div className="mt-6 space-y-5 leading-relaxed text-muted-foreground">
        <p>
          Privacy policies and terms of service change often, quietly and at length. ClauseBerry turns that history into something a person can
          follow: what changed, what it probably means, and the exact text it is based on.
        </p>
        <h2 className="pt-4 text-xl font-semibold text-foreground">Data sources and licence</h2>
        <p>
          Historical policy versions come from the <strong className="text-foreground">Platform Governance Archive (PGA v2)</strong>, collected
          with <strong className="text-foreground">Open Terms Archive</strong> (github.com/OpenTermsArchive/pga-versions). That data is licensed
          under the Open Database License (ODbL). Attribution: “Data from Open Terms Archive contributors / Platform Governance Archive.”
          Databases ClauseBerry derives from it are offered under the same licence.
        </p>
        <p>
          Newer versions may be fetched by ClauseBerry directly from public policy pages, no more than once a day, with an identifying user
          agent and robots.txt respected. Each version records where and when it was captured.
        </p>
        <h2 className="pt-4 text-xl font-semibold text-foreground">How analysis works</h2>
        <p>
          Changes are computed between consecutive clean versions after removing formatting noise. Captures that look like error pages or
          partial pages are excluded. Each meaningful change is analysed either by a configured language model with a validated JSON schema,
          or by a documented rule-based analyzer; the UI always says which.
        </p>
        <h2 className="pt-4 text-xl font-semibold text-foreground">Limits</h2>
        <p>
          Scores are estimates of a change&apos;s potential privacy impact, not legal judgements and not ratings of a company&apos;s
          trustworthiness. Archive coverage differs per app, so “first observed” dates can be later than when a practice began.
        </p>
      </div>
    </article>
  )
}
