"use client"

import { ArrowLeft, Loader2, Mail } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Field, FormError, TextInput } from "@/components/common/form"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"
import { zodResolver } from "@/lib/forms"

const schema = z.object({ email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address") })
type Values = z.infer<typeof schema>
type Result = { message: string; email_configured: boolean; dev_reset_url: string | null }

export default function ForgotPasswordPage() {
  const [result, setResult] = useState<Result | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      setResult(await api<Result>("/api/auth/forgot-password", { json: values }))
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Something went wrong.")
    }
  }

  return (
    <div>
      <Link href="/sign-in" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Enter your account email and we&apos;ll send a reset link valid for one hour.</p>
      {result ? (
        <div className="mt-7 space-y-3">
          <div className="flex gap-3 rounded-lg border bg-secondary/60 p-4 text-sm">
            <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p>{result.message}</p>
          </div>
          {!result.email_configured && (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Email delivery isn&apos;t configured on this server, so no email was sent.
              {result.dev_reset_url ? " In local development, use this link:" : ""}
            </p>
          )}
          {result.dev_reset_url && (
            <Button asChild variant="secondary" className="w-full">
              <a href={result.dev_reset_url}>Open reset link (development)</a>
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
          <FormError message={formError} />
          <Field id="email" label="Email" error={formState.errors.email?.message}>
            <TextInput id="email" type="email" autoComplete="email" invalid={!!formState.errors.email} {...register("email")} />
          </Field>
          <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
            {formState.isSubmitting && <Loader2 className="animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
    </div>
  )
}
