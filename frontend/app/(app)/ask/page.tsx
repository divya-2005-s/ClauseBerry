"use client"

import { ArrowUp, BotMessageSquare, FileText, History, Loader2, MessageSquarePlus, Quote, Sparkles, Trash2, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import useSWR from "swr"
import { toast } from "sonner"

import { LogoMark } from "@/components/brand/logo"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useMeta } from "@/hooks/use-meta"
import { api, ApiError, csrfToken } from "@/lib/api"
import { formatDate, relativeTime } from "@/lib/format"
import type { ChatMessage, Citation } from "@/lib/types"
import { cn } from "@/lib/utils"

type Session = { id: number; title: string; updated_at: string; messages: number }

function CitationCard({ c }: { c: Citation }) {
  const href = c.change_id ? `/apps/${c.app_slug}/changes/${c.change_id}` : `/apps/${c.app_slug}/versions/${c.version_id}`
  return (
    <Link
      href={href}
      id={`cite-${c.index}`}
      className="group block rounded-lg border bg-card p-3 text-xs transition-shadow hover:shadow-[var(--shadow-soft)]"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-md bg-secondary text-[11px] font-semibold text-secondary-foreground">{c.index}</span>
        <span className="truncate font-medium text-foreground">
          {c.app_name} · {c.document_type}
        </span>
      </div>
      <div className="mb-1.5 text-muted-foreground">
        {c.kind === "change" ? `Change on ${formatDate(c.version_date)}` : `Version of ${formatDate(c.version_date)}`}
        {c.section && c.kind === "policy" && <> · §&nbsp;{c.section}</>}
      </div>
      <p className="line-clamp-3 leading-relaxed text-muted-foreground group-hover:text-foreground">
        <Quote className="mr-1 inline size-3 -translate-y-0.5" aria-hidden />
        {c.quote}
      </p>
    </Link>
  )
}

function AssistantMessage({ m, onFollowUp }: { m: ChatMessage; onFollowUp: (q: string) => void }) {
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1">
        {m.meta.mode === "extractive" && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
            Extractive mode · no language model configured
          </div>
        )}
        {m.meta.error ? (
          <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> {m.content}
          </div>
        ) : m.pending && !m.content ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Searching policies…
          </div>
        ) : (
          <div className={cn("prose-chat text-sm", m.meta.insufficient_evidence && "text-muted-foreground")}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, href }) =>
                  href?.startsWith("#cite-") ? (
                    <a
                      href={href}
                      aria-label={`Source ${children}`}
                      className="mx-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-md bg-secondary px-1 align-text-top text-[11px] font-semibold text-secondary-foreground no-underline hover:bg-primary hover:text-primary-foreground"
                    >
                      {children}
                    </a>
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                      {children}
                    </a>
                  ),
                img: () => null,
              }}
            >
              {m.content.replace(/\[(\d+)\]/g, "[$1](#cite-$1)")}
            </ReactMarkdown>
          </div>
        )}
        {m.citations.length > 0 && (
          <div className="mt-3">
            <div className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <FileText className="size-3.5" /> Sources ({m.citations.length})
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {m.citations.slice(0, 6).map((c) => (
                <CitationCard key={c.chunk_id} c={c} />
              ))}
            </div>
          </div>
        )}
        {!m.pending && (m.meta.follow_ups?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.meta.follow_ups!.map((f) => (
              <button key={f} onClick={() => onFollowUp(f)} className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AskPage() {
  const { meta } = useMeta()
  const { data: sessions, mutate: refreshSessions } = useSWR<{ items: Session[] }>("/api/chat/sessions")
  const { data: suggestions } = useSWR<{ items: string[] }>("/api/chat/suggestions")
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  async function openSession(id: number) {
    setHistoryOpen(false)
    setLoadingSession(true)
    try {
      const r = await api<{ messages: ChatMessage[] }>(`/api/chat/sessions/${id}`)
      setSessionId(id)
      setMessages(r.messages)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoadingSession(false)
    }
  }

  function newChat() {
    setSessionId(null)
    setMessages([])
    setHistoryOpen(false)
  }

  async function deleteSession(id: number) {
    try {
      await api(`/api/chat/sessions/${id}`, { method: "DELETE" })
      if (id === sessionId) newChat()
      refreshSessions()
      toast.success("Conversation deleted")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    setInput("")
    let sid = sessionId
    try {
      if (!sid) {
        const s = await api<{ id: number }>("/api/chat/sessions", { json: {} })
        sid = s.id
        setSessionId(s.id)
      }
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
      return
    }
    setMessages((m) => [
      ...m,
      { role: "user", content: q, citations: [], meta: {} },
      { role: "assistant", content: "", citations: [], meta: {}, pending: true },
    ])
    const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])])

    try {
      const res = await fetch(`/api/chat/sessions/${sid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ question: q }),
      })
      if (!res.ok || !res.body) {
        let msg = "The assistant couldn't answer right now."
        try {
          msg = (await res.json()).error?.message ?? msg
        } catch {}
        throw new ApiError(res.status, "ask_failed", msg)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""
        for (const raw of events) {
          const line = raw.split("\n").find((l) => l.startsWith("data: "))
          if (!line) continue
          const ev = JSON.parse(line.slice(6))
          if (ev.type === "meta") patch((m) => ({ ...m, meta: { ...m.meta, mode: ev.mode, constraints: ev.constraints } }))
          else if (ev.type === "sources") patch((m) => ({ ...m, citations: ev.citations }))
          else if (ev.type === "token") patch((m) => ({ ...m, content: m.content + ev.text }))
          else if (ev.type === "done")
            patch((m) => ({ ...m, content: ev.content, pending: false, meta: { ...m.meta, follow_ups: ev.follow_ups, insufficient_evidence: ev.insufficient_evidence } }))
          else if (ev.type === "error") patch((m) => ({ ...m, content: ev.message, pending: false, meta: { ...m.meta, error: true } }))
        }
      }
      patch((m) => ({ ...m, pending: false }))
      refreshSessions()
    } catch (e) {
      patch((m) => ({ ...m, content: (e as Error).message, pending: false, meta: { ...m.meta, error: true } }))
    } finally {
      setBusy(false)
    }
  }

  const rag = meta?.services.rag
  const history = (
    <div className="flex h-full flex-col">
      <Button onClick={newChat} variant="outline" className="mb-3 w-full justify-start bg-card">
        <MessageSquarePlus /> New conversation
      </Button>
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent</div>
      <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
        {!sessions ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="mx-1 my-1 h-8" />)
        ) : sessions.items.length === 0 ? (
          <li className="px-1 text-sm text-muted-foreground">No conversations yet.</li>
        ) : (
          sessions.items.map((s) => (
            <li key={s.id} className="group flex items-center">
              <button
                onClick={() => openSession(s.id)}
                className={cn("min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted", s.id === sessionId && "bg-secondary text-secondary-foreground")}
              >
                <div className="truncate">{s.title}</div>
                <div className="text-[11px] text-muted-foreground">{relativeTime(s.updated_at)}</div>
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${s.title}`}>
                    <Trash2 />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                    <AlertDialogDescription>“{s.title}” and its messages will be permanently removed.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteSession(s.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))
        )}
      </ul>
    </div>
  )

  return (
    <div className="grid h-[calc(100dvh-8.5rem)] gap-5 lg:grid-cols-[240px_1fr]">
      <aside className="card-soft hidden p-3 lg:block">{history}</aside>
      <section className="card-soft flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <BotMessageSquare className="size-5 text-primary" />
          <h1 className="font-semibold">Ask ClauseBerry</h1>
          <span className="flex-1" />
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="lg:hidden">
                <History /> History
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4">
              <SheetTitle className="mb-3">Conversations</SheetTitle>
              {history}
            </SheetContent>
          </Sheet>
          {rag && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {rag.ready ? `${rag.chunks.toLocaleString()} indexed passages` : "Index not built"} ·{" "}
              {meta?.services.llm.configured ? `answers by ${meta.services.llm.model}` : "extractive answers"}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {loadingSession ? (
            <div className="space-y-4">
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto max-w-2xl py-6 text-center">
              <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-secondary">
                <LogoMark className="size-9" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">What would you like to know?</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Ask about any tracked app&apos;s privacy policy or terms. Every answer cites the policy passages it relies on, and says so when the
                evidence isn&apos;t there.
              </p>
              {rag && !rag.ready && (
                <p className="mx-auto mt-4 max-w-md rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  The search index hasn&apos;t been built on this server yet. Run <code>python -m pipeline.build_rag</code>.
                </p>
              )}
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                {(suggestions?.items ?? []).map((s) => (
                  <button key={s} onClick={() => ask(s)} className="card-soft flex items-start gap-2 p-3 text-sm transition-shadow hover:shadow-[var(--shadow-lift)]">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /> {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{m.content}</div>
                  </div>
                ) : (
                  <AssistantMessage key={i} m={m} onFollowUp={ask} />
                ),
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="border-t p-3 sm:p-4"
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
            <label htmlFor="question" className="sr-only">
              Your question
            </label>
            <Textarea
              id="question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
              placeholder="e.g. Does Reddit allow AI companies to train on posts?"
              rows={1}
              maxLength={1000}
              className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send question">
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
            Answers are generated from archived policy text and may be incomplete. Not legal advice.
          </p>
        </form>
      </section>
    </div>
  )
}
