// Renders the ClauseBerry PWA icons (PNG) from the brand mark in components/brand/logo.tsx.
// Uses the Playwright + installed Edge/Chrome already used for e2e tests; no extra software.
//   cd frontend; $env:PW_CHANNEL="msedge"; node scripts/generate-icons.mjs
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons")

// Brand mark (32×32 viewBox); visual centre ≈ (16, 16.7).
const MARK = `
  <path d="M16 3.5c3.6 2.3 7.2 3.2 10.5 3.3.4 0 .7.3.7.7v6.8c0 7.3-4.6 12.6-10.8 15.1a1.1 1.1 0 0 1-.8 0C9.4 26.9 4.8 21.6 4.8 14.3V7.5c0-.4.3-.7.7-.7 3.3-.1 6.9-1 10.5-3.3Z" fill="url(#berry)"/>
  <path d="M16.6 9.2c1.7-2.6 4.6-3.2 6.2-2.9-.4 2.1-2.4 4.3-6.2 2.9Z" fill="#7ee0b8"/>
  <circle cx="12.6" cy="16.2" r="1.25" fill="#fff" opacity=".6"/>
  <circle cx="16.4" cy="14.4" r="1.25" fill="#fff" opacity=".6"/>
  <circle cx="19.6" cy="17.2" r="1.25" fill="#fff" opacity=".6"/>
  <circle cx="14.6" cy="19.8" r="1.25" fill="#fff" opacity=".6"/>
  <circle cx="18" cy="21.4" r="1.25" fill="#fff" opacity=".6"/>
  <path d="M24.5 19.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z" fill="#ffd2bd"/>`

const DEFS = `
  <defs>
    <linearGradient id="berry" x1="6" y1="4" x2="26" y2="30" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9a82ff"/><stop offset="1" stop-color="#5b3fd1"/>
    </linearGradient>
    <linearGradient id="lavender" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f8f5ff"/><stop offset="1" stop-color="#e6ddff"/>
    </linearGradient>
  </defs>`

/** @param {"any"|"maskable"|"apple"} kind */
function svg(kind) {
  // "any": rounded tile, large mark. "maskable"/"apple": full-bleed tile, mark inside the 80% safe zone.
  const scale = kind === "any" ? 12.5 : 10
  const tile = kind === "any"
    ? `<rect x="8" y="8" width="496" height="496" rx="112" fill="url(#lavender)"/>
       <rect x="8.5" y="8.5" width="495" height="495" rx="111.5" fill="none" stroke="#7656e8" stroke-opacity=".14"/>`
    : `<rect width="512" height="512" fill="url(#lavender)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${DEFS}${tile}
    <g transform="translate(256 256) scale(${scale}) translate(-16 -16.7)">${MARK}</g></svg>`
}

const OUTPUTS = [
  { file: "icon-192.png", kind: "any", size: 192 },
  { file: "icon-512.png", kind: "any", size: 512 },
  { file: "maskable-192.png", kind: "maskable", size: 192 },
  { file: "maskable-512.png", kind: "maskable", size: 512 },
  { file: "apple-touch-icon.png", kind: "apple", size: 180 },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
try {
  for (const { file, kind, size } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    const markup = svg(kind).replace('width="512" height="512"', `width="${size}" height="${size}"`)
    await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`)
    await page.locator("svg").screenshot({ path: join(OUT, file), omitBackground: true })
    await page.close()
    console.log(`wrote public/icons/${file} (${size}×${size}, ${kind})`)
  }
} finally {
  await browser.close()
}
