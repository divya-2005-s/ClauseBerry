import type { NextConfig } from "next"

// The browser only talks to this origin; /api/* is proxied to FastAPI by the Next.js server, so session cookies
// stay first-party. BACKEND_URL is used on the server only — a phone or other device never needs to reach it,
// only this Next.js server. It is read at build time for `next build`/`next start`.
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "")
if (!/^https?:\/\/[^/\s]+$/.test(BACKEND_URL)) {
  throw new Error(`BACKEND_URL must be an origin like http://127.0.0.1:8000 (no path); got "${BACKEND_URL}"`)
}

// Extra hostnames allowed to use the *dev* server, e.g. your PC's LAN IP when testing from a phone:
//   $env:ALLOWED_DEV_ORIGINS="192.168.1.20"; npm run dev
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  allowedDevOrigins,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Always revalidate the service worker so fixes reach installed apps immediately.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
