"use client"

import { useEffect } from "react"

/**
 * Registers /sw.js in production builds only. In development the worker would cache unhashed dev assets
 * and fight hot reloading, so it is skipped (and any worker left over from a production run is removed).
 * Service workers only run in secure contexts: HTTPS, or http://localhost.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
      return
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      /* Installation and the app still work without the worker; it only adds the offline page. */
    })
  }, [])
  return null
}
