"use client"

import { Activity, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

type MonitorState = "healthy" | "changed" | "failed" | "not_checked"
type MonitorApp = {
  app_slug: string
  app_name: string
  status: MonitorState
  last_checked_at: string | null
  last_successful_check_at: string | null
  next_check_at: string | null
}
type MonitorRun = {
  id: number
  app_slug: string | null
  trigger: "manual" | "scheduler"
  status: "queued" | "running" | "success" | "partial" | "failed"
  started_at: string
  finished_at: string | null
  summary: { attempts?: number; checked?: number; changed?: number; failed?: number }
}
type Monitoring = {
  enabled: boolean
  interval_hours: number
  scheduler_running: boolean
  next_scheduled_at: string | null
  totals: { apps: number; healthy: number; changed: number; failed: number; not_checked: number }
  apps: MonitorApp[]
  runs: MonitorRun[]
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not yet"
}

function stateLabel(state: MonitorState) {
  return state.replace("_", " ")
}

export default function MonitoringPage() {
  const { data, error, mutate } = useSWR<Monitoring>("/api/monitoring")
  const [runId, setRunId] = useState<number | null>(null)

  useEffect(() => {
    if (runId === null) return
    let cancelled = false
    let timer: number
    const startedAt = Date.now()
    async function poll() {
      try {
        const run = await api<MonitorRun>(`/api/monitoring/runs/${runId}`)
        if (["success", "partial", "failed"].includes(run.status)) {
          await mutate()
          if (cancelled) return
          if (run.status === "success") toast.success(`Monitoring complete. ${run.summary.changed ?? 0} new versions found.`)
          else toast.warning(run.status === "partial" ? "Monitoring completed with failed sources." : "Monitoring failed.")
          setRunId(null)
          return
        }
      } catch (e) {
        if (!cancelled) {
          toast.error((e as Error).message)
          setRunId(null)
        }
        return
      }
      if (Date.now() - startedAt > 10 * 60_000) {
        if (!cancelled) {
          toast.info("Monitoring is still running. Refresh this page to see the latest status.")
          setRunId(null)
        }
        return
      }
      if (!cancelled) timer = window.setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mutate, runId])

  async function checkAll() {
    try {
      const run = await api<{ id: number }>("/api/monitoring/check", { method: "POST" })
      setRunId(run.id)
      toast.info("Monitoring check started.")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (error) {
    return (
      <div className="card-soft p-5" role="alert">
        <h1 className="text-xl font-semibold">Monitoring health</h1>
        <p className="mt-2 text-sm text-muted-foreground">{(error as Error).message}</p>
        <Button className="mt-4" variant="outline" onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }
  if (!data) {
    return <div className="card-soft p-5 text-sm text-muted-foreground" aria-busy="true">Loading monitoring status…</div>
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-primary" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">Monitoring health</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Checks use configured policy sources and run only while the local backend is running.
          </p>
        </div>
        <Button onClick={checkAll} disabled={runId !== null}>
          <RefreshCw className={runId !== null ? "animate-spin" : undefined} />
          {runId !== null ? "Checking…" : "Check all now"}
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Monitoring summary">
        {[
          ["Applications", data.totals.apps],
          ["Healthy", data.totals.healthy],
          ["Changed", data.totals.changed],
          ["Failed / not checked", data.totals.failed + data.totals.not_checked],
        ].map(([label, count]) => (
          <div className="card-soft p-4" key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p>
          </div>
        ))}
      </section>

      <section className="card-soft p-5">
        <h2 className="font-semibold">Schedule</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Automatic checks</dt>
            <dd className="mt-1 font-medium">{data.enabled && data.scheduler_running ? "Running" : "Disabled"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Interval</dt>
            <dd className="mt-1 font-medium">Every {data.interval_hours} hours</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Next scheduled scan</dt>
            <dd className="mt-1 font-medium">{dateTime(data.next_scheduled_at)}</dd>
          </div>
        </dl>
        {!data.scheduler_running && (
          <p className="mt-3 text-xs text-muted-foreground">
            Start the backend with policy monitoring enabled to run scheduled checks. Manual checks remain available.
          </p>
        )}
      </section>

      <section className="card-soft overflow-hidden">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Applications</h2>
        </div>
        <ul className="divide-y">
          {data.apps.map((app) => (
            <li key={app.app_slug} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <Link href={`/apps/${app.app_slug}`} className="min-w-36 font-medium hover:text-primary">
                {app.app_name}
              </Link>
              <span className="text-sm capitalize text-muted-foreground">{stateLabel(app.status)}</span>
              <span className="text-xs text-muted-foreground">
                Last checked: {dateTime(app.last_checked_at)}
              </span>
              <span className="text-xs text-muted-foreground">
                Next check: {dateTime(app.next_check_at)}
              </span>
              {app.status === "failed" && (
                <span className="text-xs text-destructive">Last successful check: {dateTime(app.last_successful_check_at)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card-soft overflow-hidden">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Recent runs</h2>
        </div>
        {data.runs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No monitoring runs yet.</p>
        ) : (
          <ul className="divide-y">
            {data.runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <span className="font-medium capitalize">{run.trigger}</span>
                <span className="capitalize text-muted-foreground">{run.status}</span>
                <span className="text-xs text-muted-foreground">{dateTime(run.started_at)}</span>
                <span className="text-xs text-muted-foreground">
                  {run.summary.changed ?? 0} new · {run.summary.failed ?? 0} failed
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
