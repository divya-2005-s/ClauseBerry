"use client"

import useSWR from "swr"

import type { Meta } from "@/lib/types"

export function useMeta() {
  const { data } = useSWR<Meta>("/api/meta", { revalidateOnFocus: false, dedupingInterval: 300_000 })
  return { meta: data, categories: data?.taxonomy.categories ?? {}, aiKinds: data?.taxonomy.ai_kinds ?? {} }
}
