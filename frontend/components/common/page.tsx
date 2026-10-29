import { Info, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.7rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("card-soft p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "berry",
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon: LucideIcon
  tone?: "berry" | "coral" | "neutral"
}) {
  const toneCls =
    tone === "coral" ? "bg-coral-soft text-coral" : tone === "neutral" ? "bg-muted text-muted-foreground" : "bg-secondary text-primary"
  return (
    <div className="card-soft flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("grid size-8 place-items-center rounded-lg", toneCls)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function Notice({ children, className, icon: Icon = Info }: { children: React.ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <div className={cn("flex gap-2.5 rounded-lg border bg-lavender px-3.5 py-2.5 text-sm text-muted-foreground", className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function AiDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Summaries, categories and risk scores are automated estimates of how a policy change may affect privacy. They are
      not legal advice and not a judgement of any company&apos;s trustworthiness — always check the source text.
    </p>
  )
}
