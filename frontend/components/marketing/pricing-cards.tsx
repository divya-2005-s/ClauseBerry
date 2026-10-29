"use client"

import { Check, Loader2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    blurb: "For individuals keeping an eye on the apps they use most.",
    features: ["Follow up to 3 applications", "Plain-English change summaries", "Full dashboard & AI-training tracker", "Ask ClauseBerry with cited answers", "CSV export (free during beta)"],
    available: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$8",
    period: "per month · planned",
    blurb: "For privacy-conscious power users, journalists and researchers.",
    features: ["Follow up to 50 applications", "Detailed side-by-side comparisons", "Advanced filters & saved views", "Priority instant notifications", "Bulk exports"],
    available: false,
    featured: true,
  },
  {
    id: "team",
    name: "Team",
    price: "$29",
    period: "per seat / month · planned",
    blurb: "For compliance, legal and IT teams monitoring third-party SaaS.",
    features: ["Shared monitoring workspaces", "Review & sign-off workflows", "Compliance reports", "Audit-friendly exports with provenance", "SSO (roadmap)"],
    available: false,
  },
] as const

export function PricingCards() {
  const { user } = useAuth()
  const [dialog, setDialog] = useState<null | "pro" | "team">(null)
  const [busy, setBusy] = useState(false)

  async function register(plan: "pro" | "team") {
    setBusy(true)
    try {
      const r = await api<{ message: string }>("/api/me/upgrade-interest", { json: { plan } })
      toast.success("You're on the list", { description: r.message })
      setDialog(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className={cn(
              "card-soft relative flex flex-col p-6",
              "featured" in t && t.featured && "border-primary/50 shadow-[var(--shadow-lift)] ring-1 ring-primary/30",
            )}
          >
            {"featured" in t && t.featured && (
              <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Most requested</span>
            )}
            <h3 className="text-lg font-semibold">{t.name}</h3>
            <p className="mt-1 min-h-10 text-sm text-muted-foreground">{t.blurb}</p>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
              <span className="text-sm text-muted-foreground">{t.period}</span>
            </div>
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {f}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {t.available ? (
                <Button asChild variant={user ? "outline" : "default"} className="h-10 w-full">
                  <Link href={user ? "/dashboard" : "/sign-up"}>{user ? (user.plan === "free" ? "Your current plan" : "Go to dashboard") : "Start free"}</Link>
                </Button>
              ) : (
                <Button variant={"featured" in t && t.featured ? "default" : "outline"} className="h-10 w-full" onClick={() => setDialog(t.id as "pro" | "team")}>
                  Join the {t.name} waitlist
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Paid plans are a product concept: billing is not live and no payment is ever collected. Prices are indicative.
      </p>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "pro" ? "Pro" : "Team"} isn&apos;t available yet</DialogTitle>
            <DialogDescription>
              Billing hasn&apos;t launched, so we can&apos;t upgrade your account today and nothing will be charged.
              {user ? " We can record your interest so you hear first when it opens." : " Create a free account to register your interest."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Close
            </Button>
            {user ? (
              <Button onClick={() => dialog && register(dialog)} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Notify me
              </Button>
            ) : (
              <Button asChild>
                <Link href="/sign-up">Create free account</Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
