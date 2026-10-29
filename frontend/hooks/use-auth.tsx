"use client"

import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { createContext, useCallback, useContext, useEffect, useMemo } from "react"
import useSWR from "swr"

import { api, ApiError } from "@/lib/api"
import type { AuthResponse, User } from "@/lib/types"

type AuthState = {
  user: User | null
  loading: boolean
  refresh: () => Promise<unknown>
  setUser: (u: User) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function hasSessionHint() {
  return typeof document !== "undefined" && document.cookie.includes("cb_csrf=")
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { setTheme } = useTheme()
  // Only ask the API when a session hint exists, so public pages don't fire 401s.
  const { data, isLoading, mutate } = useSWR<AuthResponse | null>(
    "/api/auth/me",
    async (url: string) => {
      if (!hasSessionHint()) return null
      try {
        return await api<AuthResponse>(url)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    { revalidateOnFocus: true },
  )

  const user = data?.user ?? null

  useEffect(() => {
    if (user?.theme) setTheme(user.theme)
  }, [user?.theme, setTheme])

  const setUser = useCallback(
    (u: User) => mutate((prev) => (prev ? { ...prev, user: u } : { user: u, csrf_token: "", email_delivery: "none" }), { revalidate: false }),
    [mutate],
  )

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" })
    } finally {
      await mutate(null, { revalidate: false })
      router.replace("/sign-in")
      router.refresh()
    }
  }, [mutate, router])

  const value = useMemo<AuthState>(
    () => ({ user, loading: isLoading, refresh: () => mutate(), setUser, signOut }),
    [user, isLoading, mutate, setUser, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
