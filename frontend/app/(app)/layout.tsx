import { Suspense } from "react"

import { AppShell } from "@/components/shell/app-shell"
import { Skeleton } from "@/components/ui/skeleton"

// Everything under (app) is per-user and fetched at request time, so the shell streams in behind a
// Suspense boundary instead of being prerendered (it reads the URL and the current time).
function ShellFallback() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]" aria-busy>
      <div className="hidden border-r bg-sidebar lg:block" />
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    </div>
  )
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  )
}
