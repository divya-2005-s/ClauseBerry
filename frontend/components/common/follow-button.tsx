"use client"

import { BellPlus, BellRing, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useSWRConfig } from "swr"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

export function FollowButton({
  slug,
  name,
  following,
  onChange,
  size = "sm",
  className,
}: {
  slug: string
  name: string
  following: boolean
  onChange?: (following: boolean) => void
  size?: "sm" | "default"
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const { mutate } = useSWRConfig()
  const router = useRouter()

  async function toggle() {
    setBusy(true)
    try {
      if (following) {
        await api(`/api/me/follows/${slug}`, { method: "DELETE" })
        toast.success(`Unfollowed ${name}`)
        onChange?.(false)
      } else {
        const r = await api<{ backfilled_alerts: number }>(`/api/me/follows/${slug}`, { method: "PUT" })
        toast.success(`Following ${name}`, {
          description: r.backfilled_alerts
            ? `${r.backfilled_alerts} recent change${r.backfilled_alerts === 1 ? "" : "s"} added to your alerts.`
            : "You'll get an alert when its policies change.",
        })
        onChange?.(true)
      }
      mutate((key) => typeof key === "string" && (key.startsWith("/api/alerts") || key.startsWith("/api/me/follows") || key.startsWith("/api/apps")))
    } catch (e) {
      if (e instanceof ApiError && e.code === "plan_limit") {
        toast.warning(e.message, { action: { label: "See plans", onClick: () => router.push("/pricing") } })
      } else toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant={following ? "secondary" : "outline"}
      size={size}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      }}
      disabled={busy}
      aria-pressed={following}
      className={cn(!following && "bg-card", className)}
    >
      {busy ? <Loader2 className="animate-spin" /> : following ? <BellRing /> : <BellPlus />}
      {following ? "Following" : "Follow"}
    </Button>
  )
}

export function PlanLimitHint() {
  return (
    <span className="text-xs text-muted-foreground">
      Free plan follows up to 3 apps ·{" "}
      <Link className="text-primary hover:underline" href="/pricing">
        plans
      </Link>
    </span>
  )
}
