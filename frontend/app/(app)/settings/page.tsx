"use client"

import { BellRing, KeyRound, Loader2, LogOut, Monitor, Moon, Palette, ShieldCheck, Sun, Trash2, User as UserIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useState } from "react"
import { useForm } from "react-hook-form"
import useSWR, { useSWRConfig, type KeyedMutator } from "swr"
import { toast } from "sonner"
import { z } from "zod"

import { Field, PasswordInput, TextInput } from "@/components/common/form"
import { FollowButton } from "@/components/common/follow-button"
import { Notice, PageHeader } from "@/components/common/page"
import { CardSkeleton } from "@/components/common/states"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/hooks/use-auth"
import { useMounted } from "@/hooks/use-mounted"
import { api, ApiError } from "@/lib/api"
import { zodResolver } from "@/lib/forms"
import { formatDate } from "@/lib/format"
import type { User } from "@/lib/types"

function Card({ id, icon: Icon, title, description, children }: { id?: string; icon: typeof UserIcon; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card-soft scroll-mt-20 p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Profile() {
  const { user } = useAuth()
  if (!user) return <CardSkeleton lines={3} />
  return <ProfileForm key={user.id} />
}

function ProfileForm() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.name ?? "")
  const [saving, setSaving] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error("Name can't be empty")
    setSaving(true)
    try {
      setUser(await api<User>("/api/me", { method: "PATCH", json: { name } }))
      toast.success("Profile saved")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card icon={UserIcon} title="Profile" description={`Member since ${formatDate(user?.created_at)} · ${user?.plan} plan`}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name">
          <TextInput id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field id="email" label="Email" hint={user?.email_verified ? "Verified" : "Not verified yet"}>
          <TextInput id="email" value={user?.email ?? ""} disabled readOnly />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={saving || name === user?.name}>
            {saving && <Loader2 className="animate-spin" />} Save changes
          </Button>
        </div>
      </form>
    </Card>
  )
}

const pwSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z.string().min(10, "Use at least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/[\d\W_]/, "Include a number or symbol"),
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })

function Password() {
  const { register, handleSubmit, reset, formState } = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { current_password: "", new_password: "", confirm: "" } })
  async function onSubmit(v: z.infer<typeof pwSchema>) {
    try {
      await api("/api/auth/change-password", { json: { current_password: v.current_password, new_password: v.new_password } })
      toast.success("Password changed. Other sessions were signed out.")
      reset()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't change password")
    }
  }
  const e = formState.errors
  return (
    <Card icon={KeyRound} title="Password" description="Changing it signs out your other sessions.">
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-3" noValidate>
        <Field id="current_password" label="Current password" error={e.current_password?.message}>
          <PasswordInput id="current_password" autoComplete="current-password" invalid={!!e.current_password} {...register("current_password")} />
        </Field>
        <Field id="new_password" label="New password" error={e.new_password?.message}>
          <PasswordInput id="new_password" autoComplete="new-password" invalid={!!e.new_password} {...register("new_password")} />
        </Field>
        <Field id="confirm_pw" label="Confirm new password" error={e.confirm?.message}>
          <PasswordInput id="confirm_pw" autoComplete="new-password" invalid={!!e.confirm} {...register("confirm")} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting && <Loader2 className="animate-spin" />} Update password
          </Button>
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot your current password?
          </Link>
        </div>
      </form>
    </Card>
  )
}

type Prefs = {
  email_enabled: boolean
  min_risk_score: number
  frequency: "instant" | "daily" | "weekly"
  ai_training_only: boolean
  email_configured: boolean
  email_verified: boolean
  last_email: { status: string; created_at: string } | null
}

function Notifications() {
  const { data, mutate } = useSWR<Prefs>("/api/me/notification-preferences")
  if (!data) return <CardSkeleton lines={4} />
  // Remount the form whenever saved preferences change so the draft starts from them.
  return <NotificationsForm key={JSON.stringify(data)} data={data} mutate={mutate} />
}

function NotificationsForm({ data, mutate }: { data: Prefs; mutate: KeyedMutator<Prefs> }) {
  const [draft, setDraft] = useState<Prefs>(data)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify({ ...draft, last_email: null }) !== JSON.stringify({ ...data, last_email: null })

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const { email_enabled, min_risk_score, frequency, ai_training_only } = draft
      await mutate(await api<Prefs>("/api/me/notification-preferences", { method: "PUT", json: { email_enabled, min_risk_score, frequency, ai_training_only } }), { revalidate: false })
      toast.success("Notification preferences saved")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id="notifications" icon={BellRing} title="Notifications" description="Choose which changes reach your inbox. In-app alerts are always kept.">
      {!draft.email_configured && (
        <Notice className="mb-5">
          Email delivery isn&apos;t configured on this server (no <code>RESEND_API_KEY</code>), so emails are recorded in a local outbox instead of sent.
          Your preferences are still saved.
        </Notice>
      )}
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="email_enabled">Email alerts</Label>
            <p className="text-sm text-muted-foreground">{draft.email_verified ? "Sent to your verified address." : "Verify your email to receive them."}</p>
          </div>
          <Switch id="email_enabled" checked={draft.email_enabled} onCheckedChange={(v) => setDraft({ ...draft, email_enabled: v })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="min_risk">Minimum risk to email</Label>
            <Select value={String(draft.min_risk_score)} onValueChange={(v) => setDraft({ ...draft, min_risk_score: Number(v) })}>
              <SelectTrigger id="min_risk" className="h-9 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Everything (1+)</SelectItem>
                <SelectItem value="2">Low and above (2+)</SelectItem>
                <SelectItem value="3">Medium and above (3+)</SelectItem>
                <SelectItem value="4">High and above (4+)</SelectItem>
                <SelectItem value="5">Critical only (5)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="frequency">Frequency</Label>
            <Select value={draft.frequency} onValueChange={(v) => setDraft({ ...draft, frequency: v as Prefs["frequency"] })}>
              <SelectTrigger id="frequency" className="h-9 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instant">After each pipeline run</SelectItem>
                <SelectItem value="daily">Daily digest</SelectItem>
                <SelectItem value="weekly">Weekly digest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="ai_only">Only AI-training changes</Label>
            <p className="text-sm text-muted-foreground">Email only when explicit AI-training language is added.</p>
          </div>
          <Switch id="ai_only" checked={draft.ai_training_only} onCheckedChange={(v) => setDraft({ ...draft, ai_training_only: v })} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="animate-spin" />} Save preferences
          </Button>
          {draft.last_email && (
            <span className="text-xs text-muted-foreground">
              Last email: {draft.last_email.status === "sent" ? "delivered to provider" : draft.last_email.status === "logged" ? "logged locally (not sent)" : "failed"} ·{" "}
              {formatDate(draft.last_email.created_at)}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

function Followed() {
  const { data, mutate } = useSWR<{ items: { slug: string; name: string; category: string }[]; limit: number | null }>("/api/me/follows")
  return (
    <Card icon={BellRing} title="Followed applications" description={data?.limit ? `${data.items.length} of ${data.limit} on the Free plan` : undefined}>
      {!data ? (
        <CardSkeleton lines={2} />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You don&apos;t follow any apps.{" "}
          <Link href="/apps" className="text-primary hover:underline">
            Browse applications
          </Link>
        </p>
      ) : (
        <ul className="divide-y">
          {data.items.map((f) => (
            <li key={f.slug} className="flex items-center justify-between gap-3 py-2.5">
              <Link href={`/apps/${f.slug}`} className="min-w-0">
                <div className="truncate font-medium hover:text-primary">{f.name}</div>
                <div className="text-xs text-muted-foreground">{f.category}</div>
              </Link>
              <FollowButton slug={f.slug} name={f.name} following onChange={() => mutate()} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Appearance() {
  const { theme, setTheme } = useTheme()
  const { setUser, user } = useAuth()
  const mounted = useMounted()
  async function choose(v: string) {
    setTheme(v)
    try {
      setUser(await api<User>("/api/me", { method: "PATCH", json: { theme: v } }))
    } catch {
      /* local theme still applies */
    }
  }
  const opts = [
    { v: "light", label: "Light", icon: Sun },
    { v: "dark", label: "Dark", icon: Moon },
    { v: "system", label: "System", icon: Monitor },
  ]
  return (
    <Card icon={Palette} title="Appearance" description="Saved to your account and applied on every device.">
      <RadioGroup value={mounted ? (theme ?? user?.theme ?? "system") : ""} onValueChange={choose} className="grid grid-cols-3 gap-3">
        {opts.map((o) => (
          <Label key={o.v} htmlFor={`theme-${o.v}`} className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary">
            <o.icon className="size-5" />
            <span>{o.label}</span>
            <RadioGroupItem id={`theme-${o.v}`} value={o.v} className="sr-only" />
          </Label>
        ))}
      </RadioGroup>
    </Card>
  )
}

function Danger() {
  const { signOut } = useAuth()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  async function del() {
    setBusy(true)
    try {
      await api("/api/me/delete", { json: { password } })
      await mutate(() => true, undefined, { revalidate: false })
      toast.success("Your account and data were deleted")
      router.replace("/")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card icon={ShieldCheck} title="Privacy & account" description="What ClauseBerry stores about you, and how to remove it.">
      <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Account: name, email, Argon2id password hash, theme and plan.</li>
        <li>Activity: followed apps, alerts and their read state, notification preferences and Ask ClauseBerry conversations.</li>
        <li>Sessions: a hashed session token, browser user-agent and expiry; expired sessions are purged.</li>
        <li>Questions sent to Ask ClauseBerry go to the configured language-model provider (if any) together with retrieved policy excerpts.</li>
        <li>Deleting your account removes all of the above immediately; outbound email logs keep only the recipient address and subject.</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => signOut()}>
          <LogOut /> Sign out
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 /> Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes your profile, followed apps, alerts, preferences and conversations. It can&apos;t be undone. Enter your password to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <PasswordInput id="delete_password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={del} disabled={!password || busy}>
                {busy && <Loader2 className="animate-spin" />} Delete forever
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Manage your profile, security, notifications and data." />
      <div className="space-y-5">
        <Profile />
        <Password />
        <Notifications />
        <Followed />
        <Appearance />
        <Danger />
      </div>
    </div>
  )
}
