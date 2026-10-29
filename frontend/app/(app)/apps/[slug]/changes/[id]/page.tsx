import { Suspense } from "react"

import { CardSkeleton } from "@/components/common/states"

import { ChangeDetail } from "./change-detail"

export default function ChangePage({ params }: PageProps<"/apps/[slug]/changes/[id]">) {
  return (
    <Suspense fallback={<CardSkeleton lines={8} />}>
      <Loader params={params} />
    </Suspense>
  )
}

async function Loader({ params }: { params: PageProps<"/apps/[slug]/changes/[id]">["params"] }) {
  const { slug, id } = await params
  return <ChangeDetail slug={slug} id={id} />
}
