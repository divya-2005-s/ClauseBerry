import type { Metadata } from "next"

import { PricingCards } from "@/components/marketing/pricing-cards"

export const metadata: Metadata = { title: "Pricing" }

export default function PricingPage() {
  return (
    <div className="relative">
      <div className="bg-berry-glow pointer-events-none absolute inset-x-0 top-0 h-96" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-medium text-primary">Pricing</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Start free. Scale your privacy monitoring when you need to.</h1>
          <p className="mt-4 text-muted-foreground">Everything in Free works today. Pro and Team describe where ClauseBerry is heading.</p>
        </div>
        <PricingCards />
      </div>
    </div>
  )
}
