"use client"

import { Menu } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Logo } from "@/components/brand/logo"
import { ThemeToggle } from "@/components/common/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useAuth } from "@/hooks/use-auth"

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#ai-training", label: "AI training" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
]

export function SiteHeader() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          {user ? (
            <Button asChild className="h-9">
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden h-9 sm:inline-flex">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild className="h-9">
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-5">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <nav className="mt-6 flex flex-col gap-1" aria-label="Mobile">
                {LINKS.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 hover:bg-muted">
                    {l.label}
                  </Link>
                ))}
                {!user && (
                  <Link href="/sign-in" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 hover:bg-muted">
                    Sign in
                  </Link>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-surface-2">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">Know what you agreed to. Stay ahead of what changes.</p>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Product</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/#features" className="hover:text-foreground">Features</Link></li>
            <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
            <li><Link href="/sign-up" className="hover:text-foreground">Create account</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Company</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/about" className="hover:text-foreground">About & data sources</Link></li>
            <li><Link href="/privacy" className="hover:text-foreground">Privacy notice</Link></li>
            <li><Link href="/terms" className="hover:text-foreground">Terms</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Disclaimer</h3>
          <p className="text-sm text-muted-foreground">
            ClauseBerry&apos;s summaries and risk scores are automated and are not legal advice.
          </p>
        </div>
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          Policy data: Open Terms Archive contributors / Platform Governance Archive, licensed under the Open Database License (ODbL).
          ClauseBerry is an independent project and is not affiliated with the services it tracks.
        </p>
      </div>
    </footer>
  )
}
