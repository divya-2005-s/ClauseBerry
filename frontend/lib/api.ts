/**
 * API client. All calls go to same-origin `/api/*`, which Next.js rewrites to the FastAPI backend,
 * so the HttpOnly session cookie is first-party. State-changing requests echo the CSRF cookie.
 */
export class ApiError extends Error {
  status: number
  code: string
  details?: { fields?: { field: string; message: string }[] }
  constructor(status: number, code: string, message: string, details?: ApiError["details"]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function csrfToken(): string {
  if (typeof document === "undefined") return ""
  const m = document.cookie.match(/(?:^|;\s*)cb_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ""
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: ApiError["details"] } } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body */
  }
  const fallback =
    res.status >= 500
      ? "The server ran into a problem. Please try again."
      : res.status === 429
        ? "You're going a little fast. Please wait a moment."
        : "Request failed."
  return new ApiError(res.status, body.error?.code ?? "http_error", body.error?.message ?? fallback, body.error?.details)
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const method = (rest.method ?? (json !== undefined ? "POST" : "GET")).toUpperCase()
  const h = new Headers(headers)
  if (json !== undefined) h.set("Content-Type", "application/json")
  if (method !== "GET") h.set("X-CSRF-Token", csrfToken())
  let res: Response
  try {
    res = await fetch(path, {
      ...rest,
      method,
      headers: h,
      credentials: "same-origin",
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError(0, "network_error", "Can't reach ClauseBerry. Check your connection or that the API is running.")
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const fetcher = <T,>(path: string) => api<T>(path)

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ""
}
