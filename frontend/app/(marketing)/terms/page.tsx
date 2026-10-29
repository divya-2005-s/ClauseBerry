import type { Metadata } from "next"

export const metadata: Metadata = { title: "Terms" }

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-primary">Terms</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Terms of use</h1>
      <p className="mt-3 text-sm text-muted-foreground">Template terms for this project. An operator deploying ClauseBerry should replace them with their own.</p>
      <div className="mt-8 space-y-6 leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Not legal advice</h2>
          <p>
            Summaries, categories, risk scores and chat answers are generated automatically and may be wrong or incomplete. They are provided for
            information only and are not legal advice. Always read the original policy text.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Source data</h2>
          <p>
            Policy texts belong to their publishers. The archive data is provided by Open Terms Archive contributors / Platform Governance Archive
            under the Open Database License (ODbL); derived databases are shared under the same terms.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Acceptable use</h2>
          <p>Don&apos;t attempt to access other users&apos; data, overload the service, or use automated means to scrape it.</p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Paid plans</h2>
          <p>Pro and Team are not yet available. No payment is collected and registering interest does not change your plan.</p>
        </section>
      </div>
    </article>
  )
}
