import { cn } from "@/lib/utils"

// Tasteful monogram fallback (no third-party logos are bundled or hot-linked).
const TINTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"]

export function AppAvatar({ name, className }: { name: string; className?: string }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const tint = TINTS[h % TINTS.length]
  const letters = name.length <= 2 ? name : name.replace(/[^A-Za-z]/g, "").slice(0, 2)
  return (
    <span
      aria-hidden
      className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-sm font-semibold", className)}
      style={{ background: `color-mix(in oklab, ${tint} 16%, transparent)`, color: tint }}
    >
      {letters.slice(0, 1).toUpperCase() + letters.slice(1, 2).toLowerCase()}
    </span>
  )
}
