import type { FieldErrors, FieldValues, Resolver } from "react-hook-form"
import type { ZodType } from "zod"

/** Minimal zod → react-hook-form resolver (avoids @hookform/resolvers' optional peer conflicts). */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values)
    if (result.success) return { values: result.data, errors: {} }
    const errors: Record<string, { type: string; message: string }> = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join(".")
      if (!errors[key]) errors[key] = { type: issue.code, message: issue.message }
    }
    return { values: {}, errors: errors as unknown as FieldErrors<T> }
  }
}

export function passwordStrength(pw: string): { score: number; label: string; hints: string[] } {
  const hints: string[] = []
  if (pw.length < 10) hints.push("At least 10 characters")
  if (!/[A-Za-z]/.test(pw) || !/[\d\W_]/.test(pw)) hints.push("Mix letters with numbers or symbols")
  let score = 0
  if (pw.length >= 10) score++
  if (pw.length >= 14) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^\w\s]/.test(pw)) score++
  score = Math.min(4, Math.max(pw ? 1 : 0, score - (hints.length ? 1 : 0)))
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][score]
  return { score, label, hints }
}
