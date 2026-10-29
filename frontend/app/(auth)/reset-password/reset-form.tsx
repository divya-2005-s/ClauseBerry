"use client"

import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Field, FormError, PasswordInput } from "@/components/common/form"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"
import { zodResolver } from "@/lib/forms"

const schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/[\d\W_]/, "Include a number or symbol"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
type Values = z.infer<typeof schema>

export function ResetForm() {
  const token = useSearchParams().get("token")
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } })

  if (!token) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Link missing</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page needs the reset link from your email.</p>
        <Button asChild className="mt-6 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    )
  }

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await api("/api/auth/reset-password", { json: { token, password: values.password } })
      router.replace("/sign-in?reset=1")
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Something went wrong.")
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">You&apos;ll be signed out on all devices after the change.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />
        <Field id="password" label="New password" error={formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="new-password" invalid={!!formState.errors.password} {...register("password")} />
        </Field>
        <Field id="confirm" label="Confirm new password" error={formState.errors.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" invalid={!!formState.errors.confirm} {...register("confirm")} />
        </Field>
        <Button type="submit" className="h-10 w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </form>
    </div>
  )
}
