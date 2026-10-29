import { Suspense } from "react"

import { CardSkeleton } from "@/components/common/states"

import { CompareView } from "./compare-view"

export default function ComparePage() {
  return (
    <Suspense fallback={<CardSkeleton lines={8} />}>
      <CompareView />
    </Suspense>
  )
}
