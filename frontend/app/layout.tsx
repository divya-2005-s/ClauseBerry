import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import { Providers } from "@/components/providers"
import "./globals.css"

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "ClauseBerry — AI Privacy Intelligence", template: "%s · ClauseBerry" },
  description:
    "Know what you agreed to. Stay ahead of what changes. ClauseBerry tracks privacy policy and terms changes, explains them in plain English and flags AI-training clauses.",
  applicationName: "ClauseBerry",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Standalone launch from the home screen (iOS reads these; Android uses app/manifest.ts).
  appleWebApp: { capable: true, title: "ClauseBerry", statusBarStyle: "default" },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#13111f" },
  ],
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
