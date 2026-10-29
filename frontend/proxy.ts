import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Coarse routing gate: send visitors without a session cookie to sign-in.
 * This is a UX convenience only — every API endpoint verifies the session server-side.
 */
const PROTECTED = ["/dashboard", "/apps", "/ai-training", "/ask", "/alerts", "/settings"]
const AUTH_PAGES = ["/sign-in", "/sign-up"]

export function proxy(request: NextRequest) {
  // Only redirect real page loads. The App Router's background data/prefetch requests (RSC) must not be
  // redirected: e.g. a prefetched /sign-up link followed by a redirect to /dashboard makes the router ask
  // /dashboard for the sign-up segment, which 404s. Client-side, AppShell sends signed-out users to sign-in.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  const hasSession = request.cookies.has("cb_session")
  if (!hasSession && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL("/sign-in", request.url)
    url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  return NextResponse.next()
}

export const config = {
  // Static PWA files (manifest, service worker, offline page, icons) never need the auth gate.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
}
