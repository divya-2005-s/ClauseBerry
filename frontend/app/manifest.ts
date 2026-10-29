import type { MetadataRoute } from "next"

/** Web app manifest (served at /manifest.webmanifest) — makes ClauseBerry installable as a PWA. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ClauseBerry",
    short_name: "ClauseBerry",
    description: "Know what you agreed to. Track privacy policy changes, risk and AI-training clauses.",
    lang: "en",
    dir: "ltr",
    // Opens straight into the app; signed-out users are redirected to sign-in by proxy.ts.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#faf9fc", // warm white splash, matches the light theme background
    theme_color: "#faf9fc",
    categories: ["productivity", "utilities"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Dashboard", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Ask ClauseBerry", url: "/ask", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Alerts", url: "/alerts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  }
}
