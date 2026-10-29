import { Suspense } from "react"

import { CardSkeleton } from "@/components/common/states"

import { VersionView } from "./version-view"

export default function VersionPage({ params }: PageProps<"/apps/[slug]/versions/[id]">) {
  return (
    <Suspense fallback={<CardSkeleton lines={10} />}>
      <Loader params={params} />
    </Suspense>
  )
}

async function Loader({ params }: { params: PageProps<"/apps/[slug]/versions/[id]">["params"] }) {
  const { slug, id } = await params
  return <VersionView slug={slug} id={id} />
}
