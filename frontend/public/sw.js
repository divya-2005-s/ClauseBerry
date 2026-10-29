/* ClauseBerry service worker — deliberately minimal and privacy-safe.
 *
 * Caches ONLY public, user-independent files:
 *   - the static offline page and app icons (precached), and
 *   - content-hashed build assets under /_next/static/ (identical for every user).
 * It NEVER caches /api/* (accounts, sessions, chat, alerts, policy data), page HTML, RSC payloads or any
 * non-GET request. Page navigations always go to the network; the offline page is shown only if that fails.
 */
const VERSION = "clauseberry-v1"
const OFFLINE_URL = "/offline.html"
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icon.svg"]
const MAX_RUNTIME_ENTRIES = 200

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isCacheableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")
}

async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_RUNTIME_ENTRIES; i++) await cache.delete(keys[i])
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return // private data: always straight to the network, never cached

  if (request.mode === "navigate") {
    // Network only (pages can contain account data); fall back to the static offline page.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  if (isCacheableAsset(url)) {
    // Content-hashed, public build assets: cache first.
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok && response.type === "basic" && !response.headers.has("Set-Cookie")) {
          await cache.put(request, response.clone())
          trim(cache)
        }
        return response
      }),
    )
  }
  // Everything else (RSC payloads, other files): default network behaviour, not cached.
})
