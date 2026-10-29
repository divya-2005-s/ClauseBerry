import { AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error?: Error | null; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center", className)}>
      <AlertTriangle className="mb-3 size-6 text-destructive" aria-hidden />
      <h3 className="font-semibold">We couldn&apos;t load this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error?.message ?? "Something went wrong."}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  )
}

export function CardSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("card-soft space-y-3 p-5", className)} aria-hidden>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i % 2 ? "w-4/5" : "w-full")} />
      ))}
    </div>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("card-soft p-5", className)} aria-hidden>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-6 h-3 w-64" />
      <div className="flex h-48 items-end gap-2">
        {[40, 65, 30, 80, 55, 70, 45, 90, 60, 35].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}
