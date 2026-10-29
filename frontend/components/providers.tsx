"use client"

import { ThemeProvider } from "next-themes"
import { SWRConfig } from "swr"

import { RegisterServiceWorker } from "@/components/pwa/register-service-worker"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/hooks/use-auth"
import { ApiError, fetcher } from "@/lib/api"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig
        value={{
          fetcher,
          revalidateOnFocus: false,
          shouldRetryOnError: (err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500),
          errorRetryCount: 2,
        }}
      >
        <AuthProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </AuthProvider>
        <Toaster position="top-right" richColors closeButton />
        <RegisterServiceWorker />
      </SWRConfig>
    </ThemeProvider>
  )
}
