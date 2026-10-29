"use client"

import { useSyncExternalStore } from "react"

const noop = () => () => {}

/** False during SSR and hydration, true afterwards — for UI that depends on client-only state (e.g. theme). */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false)
}
