"use client"

import { CircleCheck, CircleX, Loader2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { api, ApiError } from "@/lib/api"

export function VerifyEmail() {
  const token = useSearchParams().get("token")
  const { refresh, user } = useAuth()
  const [result, setState] = useState<{ status: "working" | "ok" | "error"; message?: string }>({ status: "working" })
  const state = token ? result : { status: "error" as const, message: "This page needs the link from your verification email." }
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || !token) return
    ran.current = true
    api("/api/auth/verify-email", { json: { token } })
      .then(() => {
        setState({ status: "ok" })
        refresh()
      })
      .catch((e) => setState({ status: "error", message: e instanceof ApiError ? e.message : "Verification failed." }))
  }, [token, refresh])

  return (
    <div className="text-center">
      {state.status === "working" && (
        <>
          <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">Verifying your email…</h1>
        </>
      )}
      {state.status === "ok" && (
        <>
          <CircleCheck className="mx-auto mb-4 size-10 text-success" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Email confirmed</h1>
          <p className="mt-2 text-sm text-muted-foreground">You&apos;ll now be able to receive change alerts by email once delivery is configured.</p>
          <Button asChild className="mt-6 h-10 w-full">
            <Link href={user ? "/dashboard" : "/sign-in"}>{user ? "Go to dashboard" : "Sign in"}</Link>
          </Button>
        </>
      )}
      {state.status === "error" && (
        <>
          <CircleX className="mx-auto mb-4 size-10 text-destructive" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t verify that link</h1>
          <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href={user ? "/settings" : "/sign-in"}>{user ? "Resend from settings" : "Sign in"}</Link>
          </Button>
        </>
      )}
    </div>
  )
}
