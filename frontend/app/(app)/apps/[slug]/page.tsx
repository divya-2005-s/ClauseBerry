import { Suspense } from "react"

import { CardSkeleton } from "@/components/common/states"

import { AppDetail } from "./app-detail"

export default function AppDetailPage({ params }: PageProps<"/apps/[slug]">) {
  return (
    <Suspense fallback={<CardSkeleton lines={6} />}>
      <AppDetailLoader params={params} />
    </Suspense>
  )
}

async function AppDetailLoader({ params }: { params: PageProps<"/apps/[slug]">["params"] }) {
  const { slug } = await params
  return <AppDetail slug={slug} />
}
