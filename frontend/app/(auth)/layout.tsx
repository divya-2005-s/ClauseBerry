import { ShieldCheck, Sparkles, TrendingUp } from "lucide-react"

import { Logo } from "@/components/brand/logo"
import { ThemeToggle } from "@/components/common/theme-toggle"

function InsightPreview() {
  // Illustrative card styled like the product's change cards (clearly labelled as an example).
  return (
    <div className="relative mt-10 max-w-md">
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-primary/10 blur-2xl" aria-hidden />
      <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-[var(--shadow-lift)] backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Example change card</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 text-xs font-medium">
            <Sparkles className="size-3 text-coral" aria-hidden /> AI training
          </span>
        </div>
        <p className="text-sm leading-relaxed">
          A policy update adds a sentence allowing personal data to be used to{" "}
          <mark className="diff-ins">develop and train AI models</mark>.
        </p>
        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <TrendingUp className="size-3.5" aria-hidden /> Expanded permission
          </span>
          <span>·</span>
          <span>Evidence quoted from the source policy</span>
        </div>
      </div>
    </div>
  )
}

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-lavender lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_30%_40%,black,transparent)]" aria-hidden />
        <div className="bg-berry-glow absolute inset-0" aria-hidden />
        <div className="relative">
          <Logo />
        </div>
        <div className="relative">
          <h2 className="max-w-md text-4xl font-semibold leading-[1.1] tracking-tight">
            Your privacy deserves a <span className="text-primary">closer look.</span>
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            ClauseBerry follows the privacy policies and terms of the apps you use, explains each change in plain
            English and flags when AI-training language appears.
          </p>
          <InsightPreview />
        </div>
        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Passwords are hashed with Argon2id. Sessions use secure, HTTP-only cookies.
        </div>
      </aside>
      <main className="relative flex flex-col">
        <div className="flex items-center justify-between p-5 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  )
}
