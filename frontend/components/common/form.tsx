"use client"

import { Eye, EyeOff } from "lucide-react"
import { forwardRef, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function Field({
  id,
  label,
  error,
  hint,
  children,
  aside,
}: {
  id: string
  label: string
  error?: string
  hint?: React.ReactNode
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { invalid?: boolean }>(
  function TextInput({ className, invalid, id, ...props }, ref) {
    return (
      <Input
        ref={ref}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={cn("h-10 bg-card", className)}
        {...props}
      />
    )
  },
)

export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<"input"> & { invalid?: boolean }>(
  function PasswordInput({ className, ...props }, ref) {
    const [show, setShow] = useState(false)
    return (
      <div className="relative">
        <TextInput ref={ref} type={show ? "text" : "password"} className={cn("pr-10", className)} {...props} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    )
  },
)

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}
