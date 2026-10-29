"use client"

import {
  Bell,
  BotMessageSquare,
  Gem,
  Activity,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { Logo } from "@/components/brand/logo"
import { ThemeToggle } from "@/components/common/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type NavItem = { href: string; label: string; icon: LucideIcon; badge?: number }

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden />
            <span className="flex-1">{item.label}</span>
            {!!item.badge && (
              <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

function VerifyBanner() {
  const { user } = useAuth()
  const [sending, setSending] = useState(false)
  if (!user || user.email_verified) return null
  async function resend() {
    setSending(true)
    try {
      const r = await api<{ email_delivery: string; dev_verification_url?: string | null }>("/api/auth/resend-verification", { method: "POST" })
      if (r.email_delivery === "sent") toast.success("Verification email sent")
      else if (r.dev_verification_url) {
        toast.info("Email delivery isn't configured — opening the development verification link.")
        window.location.href = r.dev_verification_url
      } else toast.warning("Email delivery isn't configured on this server, so no email was sent.")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="border-b bg-lavender px-4 py-2 text-center text-sm text-muted-foreground sm:px-6">
      Confirm your email to enable alert emails.{" "}
      <button onClick={resend} disabled={sending} className="font-medium text-primary hover:underline disabled:opacity-60">
        {sending ? "Sending…" : "Resend verification"}
      </button>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { data: unread } = useSWR<{ unread: number }>(user ? "/api/alerts/unread-count" : null, { refreshInterval: 60_000 })

  useEffect(() => {
    if (!loading && !user) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`)
  }, [loading, user, router, pathname])

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/monitoring", label: "Monitoring", icon: Activity },
    { href: "/apps", label: "Applications", icon: LayoutGrid },
    { href: "/ai-training", label: "AI-training tracker", icon: Sparkles },
    { href: "/ask", label: "Ask ClauseBerry", icon: BotMessageSquare },
    { href: "/alerts", label: "Alerts", icon: Bell, badge: unread?.unread },
    { href: "/settings", label: "Settings", icon: Settings },
  ]

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const sidebarFooter = (
    <div className="rounded-xl border bg-lavender p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gem className="size-4 text-primary" aria-hidden /> {user?.plan === "free" ? "Free plan" : `${user?.plan} plan`}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Follow up to 3 apps. See what Pro and Team will add.</p>
      <Link href="/pricing" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
        Compare plans →
      </Link>
    </div>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar p-4 lg:flex">
        <Logo className="mb-6 px-1.5" />
        <NavLinks items={items} />
        <div className="mt-auto">{sidebarFooter}</div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Logo className="mb-6 px-1.5" />
              <NavLinks items={items} onNavigate={() => setOpen(false)} />
              <div className="mt-6">{sidebarFooter}</div>
            </SheetContent>
          </Sheet>
          <Logo compact className="lg:hidden" />
          <div className="flex-1" />
          <ThemeToggle />
          <Button asChild variant="ghost" size="icon" aria-label="Alerts" className="relative">
            <Link href="/alerts">
              <Bell />
              {!!unread?.unread && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-coral" aria-hidden />}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 rounded-full" aria-label="Account menu">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="truncate text-sm font-medium">{user?.name}</div>
                <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/pricing">
                  <Gem /> Plans & pricing
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <VerifyBanner />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {!loading && !user ? (
            <div className="space-y-4" aria-busy>
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-80" />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  )
}
