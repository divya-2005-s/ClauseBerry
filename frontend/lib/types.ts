export type User = {
  id: number
  email: string
  name: string
  plan: "free" | "pro" | "team"
  theme: "system" | "light" | "dark"
  email_verified: boolean
  created_at: string
}

export type AuthResponse = {
  user: User
  csrf_token: string
  email_delivery: "sent" | "logged" | "failed" | "none"
  dev_verification_url?: string | null
}

export type AiStatus = {
  status: "explicit_training" | "training_removed" | "ai_provider_sharing" | "general_ai" | "none"
  label: string
  current_kinds?: string[]
  ever_kinds?: string[]
}

export type AppSummary = {
  id: number
  slug: string
  name: string
  category: string
  website: string | null
  description: string | null
  note: string | null
  latest_policy_date: string | null
  versions: number
  meaningful_changes: number
  latest_risk_score: number | null
  avg_risk_score: number | null
  ai_status: AiStatus
  following: boolean
}

export type Paged<T> = { items: T[]; total: number; page: number; pages: number; page_size?: number }

export type ChangeRow = {
  id: number
  change_date: string
  previous_date: string
  document_type: string
  words_added: number
  words_removed: number
  words_before: number
  words_after: number
  is_meaningful: number
  noise_reason: string | null
  from_version_id: number
  to_version_id: number
  summary: string | null
  category: string | null
  category_label?: string
  risk_score: number | null
  risk_level: string | null
  ai_training_mentioned: boolean
  change_direction: string | null
  analyzer: "heuristic" | "llm" | null
  model: string | null
}

export type Analysis = {
  id: number
  analyzer: "heuristic" | "llm"
  model: string
  prompt_version: string
  summary: string
  category: string
  category_label: string
  secondary_categories: string[]
  risk_score: number
  risk_level: string
  ai_training_mentioned: boolean
  ai_training_evidence: string | null
  change_direction: string
  reasoning: string
  confidence: number | null
  is_current: number
  created_at: string
}

export type VersionMeta = {
  id: number
  version_date: string
  version_datetime: string
  word_count: number
  source: "dataset" | "fetched"
  source_ref: string | null
  retrieved_at: string | null
  quality_flag: string
  document_type: string
  document_id: number
  app_name: string
  app_slug: string
}

export type DiffBlock =
  | { type: "equal"; old: string; new: string }
  | { type: "added"; old: string; new: string }
  | { type: "removed"; old: string; new: string }
  | { type: "modified"; old: string; new: string; words: { op: "equal" | "insert" | "delete"; text: string }[] }
  | { type: "skip"; lines: number }

export type Citation = {
  index: number
  chunk_id: string
  kind: "policy" | "change"
  app_name: string
  app_slug: string
  document_type: string
  version_id: number
  version_date: string
  section: string | null
  change_id: number | null
  quote: string
  relevance: number
}

export type ChatMessage = {
  id?: number
  role: "user" | "assistant"
  content: string
  citations: Citation[]
  meta: {
    mode?: string
    follow_ups?: string[]
    error?: boolean
    insufficient_evidence?: boolean
    constraints?: { apps: string[] }
  }
  pending?: boolean
}

export type Meta = {
  coverage: {
    first_version_date: string
    last_version_date: string
    versions: number
    last_fetch_at: string | null
    analyzers: Record<string, number>
    pipeline: Record<string, { status: string; finished_at: string }>
  }
  taxonomy: {
    categories: Record<string, string>
    risk_levels: Record<string, string>
    risk_rubric: Record<string, string>
    ai_kinds: Record<string, string>
  }
  services: {
    llm: { configured: boolean; model: string | null }
    email: { configured: boolean }
    rag: { ready: boolean; chunks: number; reason?: string | null; embedding_model?: string }
  }
  plan_limits: { free_follow_limit: number }
}
