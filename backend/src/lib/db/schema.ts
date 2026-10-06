import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

/** Kysely types mirror the database (snake_case). Later tasks add tables here. */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>

export interface AppUserTable {
  id: Generated<string>
  email: string
  password_hash: string
  display_name: string
  time_zone: string
  created_at: CreatedAt
  deleted_at: Date | null
  /** Per-user generation lock; null when free. */
  generation_started_at: Date | null
}

export interface SessionTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  expires_at: Date
  created_at: CreatedAt
}

/** Owned by rate-limiter-flexible; never queried directly by app code. */
export interface RateLimitTable {
  key: string
  points: Generated<number>
  /** Epoch milliseconds. */
  expire: string | null
  created_at: CreatedAt
}

export interface TopicTable {
  id: string
  name: string
  position: number
  created_at: CreatedAt
}

export interface ThreadTable {
  id: Generated<string>
  user_id: string
  topic_id: string
  title: string
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>
  deleted_at: Date | null
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'complete' | 'incomplete' | 'failed'
export type MessageStopReason =
  'end_turn' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'aborted' | 'error'

export interface MessageTable {
  id: Generated<string>
  thread_id: string
  user_id: string
  role: MessageRole
  content: string
  status: MessageStatus
  stop_reason: MessageStopReason | null
  created_at: CreatedAt
}

export interface AiCallTable {
  id: Generated<string>
  user_id: string
  kind: 'explain' | 'guide' | 'quiz'
  model: string
  input_token: number
  output_token: number
  cache_read_token: number
  stop_reason: string | null
  refusal_category: string | null
  latency_ms: number
  created_at: CreatedAt
}

export interface GuideTable {
  id: Generated<string>
  user_id: string
  thread_id: string
  topic_id: string
  title: string
  created_at: CreatedAt
}

export interface GuideStepTable {
  id: Generated<string>
  guide_id: string
  user_id: string
  position: number
  title: string
  body: string
  code: string | null
  code_language: string | null
  hint: string
  hint_revealed_at: Date | null
  done_at: Date | null
  created_at: CreatedAt
}

export interface Database {
  app_user: AppUserTable
  session: SessionTable
  rate_limit: RateLimitTable
  topic: TopicTable
  thread: ThreadTable
  message: MessageTable
  ai_call: AiCallTable
  guide: GuideTable
  guide_step: GuideStepTable
}

export type AppUserRow = Selectable<AppUserTable>
export type NewAppUser = Insertable<AppUserTable>
export type AppUserUpdate = Updateable<AppUserTable>
export type SessionRow = Selectable<SessionTable>
export type ThreadRow = Selectable<ThreadTable>
export type MessageRow = Selectable<MessageTable>
export type GuideRow = Selectable<GuideTable>
export type GuideStepRow = Selectable<GuideStepTable>
export type NewAiCall = Insertable<AiCallTable>
