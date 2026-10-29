import type { Metadata } from "next"

export const metadata: Metadata = { title: "Privacy notice" }

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-primary">Privacy notice</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">How ClauseBerry handles your data</h1>
      <p className="mt-3 text-sm text-muted-foreground">This notice describes the software as built. An operator deploying it should review and adapt it.</p>
      <div className="mt-8 space-y-6 leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">What we store</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account: your name, email address and a salted Argon2id hash of your password (never the password itself).</li>
            <li>Sessions: a SHA-256 hash of your session token, your browser user-agent and the expiry time.</li>
            <li>Activity: the apps you follow, your alerts and read state, notification preferences, theme and your Ask ClauseBerry conversations.</li>
            <li>Email log: recipient, subject and delivery status of messages we send you.</li>
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Who else sees it</h2>
          <p>
            If an email provider (Resend) is configured, your email address and message content are sent to it for delivery. If a language model
            (Google Gemini) is configured, your chat questions and retrieved public policy excerpts are sent to it to generate answers. No data is
            sold or used for advertising.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Cookies</h2>
          <p>Two first-party cookies: an HTTP-only session cookie and a CSRF-protection cookie. No analytics or advertising cookies are used.</p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Retention and deletion</h2>
          <p>
            Data is kept while your account exists. Deleting your account in Settings removes your profile, sessions, follows, alerts, preferences
            and conversations immediately. Email log entries are detached from your account.
          </p>
        </section>
      </div>
    </article>
  )
}
