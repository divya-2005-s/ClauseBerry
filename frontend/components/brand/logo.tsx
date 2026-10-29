import Link from "next/link"
import { useId } from "react"

import { cn } from "@/lib/utils"

/** ClauseBerry mark: a shield whose body is a berry, with a leaf and a sparkle. */
export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a shared id breaks when the first copy is inside a hidden element.
  const gradient = `cb-berry-${useId().replace(/:/g, "")}`
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <defs>
        <linearGradient id={gradient} x1="6" y1="4" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9a82ff" />
          <stop offset="1" stopColor="#5b3fd1" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.5c3.6 2.3 7.2 3.2 10.5 3.3.4 0 .7.3.7.7v6.8c0 7.3-4.6 12.6-10.8 15.1a1.1 1.1 0 0 1-.8 0C9.4 26.9 4.8 21.6 4.8 14.3V7.5c0-.4.3-.7.7-.7 3.3-.1 6.9-1 10.5-3.3Z"
        fill={`url(#${gradient})`}
      />
      <path d="M16.6 9.2c1.7-2.6 4.6-3.2 6.2-2.9-.4 2.1-2.4 4.3-6.2 2.9Z" fill="#7ee0b8" />
      <circle cx="12.6" cy="16.2" r="1.25" fill="#fff" opacity=".55" />
      <circle cx="16.4" cy="14.4" r="1.25" fill="#fff" opacity=".55" />
      <circle cx="19.6" cy="17.2" r="1.25" fill="#fff" opacity=".55" />
      <circle cx="14.6" cy="19.8" r="1.25" fill="#fff" opacity=".55" />
      <circle cx="18" cy="21.4" r="1.25" fill="#fff" opacity=".55" />
      <path d="M24.5 19.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z" fill="#ffd2bd" />
    </svg>
  )
}

export function Logo({ className, href = "/", compact = false }: { className?: string; href?: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      aria-label="ClauseBerry home"
      className={cn("inline-flex items-center gap-2 rounded-lg font-semibold tracking-tight", className)}
    >
      <LogoMark />
      {!compact && (
        <span className="text-[1.05rem]">
          Clause<span className="text-primary">Berry</span>
        </span>
      )}
    </Link>
  )
}
