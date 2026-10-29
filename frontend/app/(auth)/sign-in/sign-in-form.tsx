"use client"

import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Field, FormError, PasswordInput, TextInput } from "@/components/common/form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { api, ApiError } from "@/lib/api"
import { zodResolver } from "@/lib/forms"
import type { AuthResponse } from "@/lib/types"

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
})
type Values = z.infer<typeof schema>

function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"
}

export function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { setUser } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, setValue, control, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", remember: true },
  })
  const { errors, isSubmitting } = formState
  const remember = useWatch({ control, name: "remember" })

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      const res = await api<AuthResponse>("/api/auth/login", { json: values })
      setUser(res.user)
      toast.success(`Welcome back, ${res.user.name.split(" ")[0]}`)
      router.replace(safeNext(params.get("next")))
      router.refresh()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Sign-in failed. Please try again.")
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Sign in to see what changed in the apps you follow.</p>
      {params.get("reset") === "1" && (
        <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          Your password was updated. Sign in with your new password.
        </p>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />
        <Field id="email" label="Email" error={errors.email?.message}>
          <TextInput id="email" type="email" autoComplete="email" placeholder="you@example.com" invalid={!!errors.email} {...register("email")} />
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          aside={
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput id="password" autoComplete="current-password" invalid={!!errors.password} {...register("password")} />
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setValue("remember", v === true)} />
          <Label htmlFor="remember" className="font-normal text-muted-foreground">
            Keep me signed in for 30 days
          </Label>
        </div>
        <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to ClauseBerry?{" "}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
