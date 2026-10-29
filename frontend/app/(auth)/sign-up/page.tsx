"use client"

import { Check, Loader2, MailCheck } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Field, FormError, PasswordInput, TextInput } from "@/components/common/form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/hooks/use-auth"
import { api, ApiError } from "@/lib/api"
import { passwordStrength, zodResolver } from "@/lib/forms"
import type { AuthResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

const schema = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you").max(80),
    email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128)
      .regex(/[A-Za-z]/, "Include at least one letter")
      .regex(/[\d\W_]/, "Include a number or symbol"),
    confirm: z.string(),
    accept_terms: z.boolean().refine((v) => v, "Please accept to continue"),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
type Values = z.infer<typeof schema>

function StrengthMeter({ password }: { password: string }) {
  const { score, label, hints } = passwordStrength(password)
  if (!password) return <span>At least 10 characters, mixing letters with numbers or symbols.</span>
  const tone = score <= 1 ? "bg-destructive" : score === 2 ? "bg-warning" : "bg-success"
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full bg-muted", i <= score && tone)} />
        ))}
      </div>
      <span>
        Strength: <strong className="font-medium text-foreground">{label}</strong>
        {hints.length > 0 && ` — ${hints.join(", ").toLowerCase()}`}
      </span>
    </div>
  )
}

export default function SignUpPage() {
  const router = useRouter()
  const { setUser } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<AuthResponse | null>(null)
  const { register, handleSubmit, control, setValue, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirm: "", accept_terms: false },
  })
  const { errors, isSubmitting } = formState
  const pw = useWatch({ control, name: "password" })
  const accepted = useWatch({ control, name: "accept_terms" })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      const res = await api<AuthResponse>("/api/auth/signup", {
        json: { name: values.name, email: values.email, password: values.password, accept_terms: values.accept_terms },
      })
      setUser(res.user)
      setCreated(res)
      toast.success("Account created")
    } catch (e) {
      if (e instanceof ApiError) {
        for (const f of e.details?.fields ?? []) {
          if (["name", "email", "password", "accept_terms"].includes(f.field)) setError(f.field as keyof Values, { message: f.message })
        }
        setFormError(e.message)
      } else setFormError("We couldn't create your account. Please try again.")
    }
  }

  if (created) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-secondary text-primary">
          <MailCheck className="size-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        {created.email_delivery === "sent" ? (
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to <strong className="text-foreground">{created.user.email}</strong>.
          </p>
        ) : (
          <div className="mt-3 space-y-3 text-left text-sm">
            <p className="rounded-lg border border-dashed bg-muted/50 p-3 text-muted-foreground">
              <strong className="text-foreground">Email delivery isn&apos;t configured on this server</strong>, so no
              email was sent. {created.dev_verification_url ? "In local development you can verify with the link below (it is also printed in the API log)." : "Ask the administrator to configure RESEND_API_KEY."}
            </p>
            {created.dev_verification_url && (
              <Button asChild variant="secondary" className="w-full">
                <a href={created.dev_verification_url}>Verify email (development link)</a>
              </Button>
            )}
          </div>
        )}
        <Button className="mt-6 h-10 w-full" onClick={() => router.replace("/dashboard")}>
          Continue to dashboard
        </Button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Free plan · follow up to 3 apps · no card required.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />
        <Field id="name" label="Name" error={errors.name?.message}>
          <TextInput id="name" autoComplete="name" placeholder="Alex Rivera" invalid={!!errors.name} {...register("name")} />
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          <TextInput id="email" type="email" autoComplete="email" placeholder="you@example.com" invalid={!!errors.email} {...register("email")} />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message} hint={<StrengthMeter password={pw} />}>
          <PasswordInput id="password" autoComplete="new-password" invalid={!!errors.password} {...register("password")} />
        </Field>
        <Field id="confirm" label="Confirm password" error={errors.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" invalid={!!errors.confirm} {...register("confirm")} />
        </Field>
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <Checkbox
              id="accept_terms"
              className="mt-0.5"
              checked={accepted}
              onCheckedChange={(v) => setValue("accept_terms", v === true, { shouldValidate: formState.isSubmitted })}
              aria-invalid={!!errors.accept_terms || undefined}
            />
            <label htmlFor="accept_terms" className="text-sm leading-snug text-muted-foreground">
              I agree to the{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline" target="_blank">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="font-medium text-primary hover:underline" target="_blank">
                Privacy Notice
              </Link>
              .
            </label>
          </div>
          {errors.accept_terms && <p className="text-xs text-destructive">{errors.accept_terms.message}</p>}
        </div>
        <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
