import Link from "next/link"

import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="bg-berry-glow grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <LogoMark className="mx-auto size-12" />
        <p className="mt-6 text-sm font-medium text-primary">404</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-muted-foreground">It may have moved, or the link might be incomplete.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
