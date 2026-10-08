import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import type { MessageRow } from '../../lib/db/schema.js'
import { badRequest, conflict } from '../../lib/error.js'
import { hasNoNul } from '../../lib/validation.js'
import { ownedBy, requireFound, type Auth } from '../../lib/ownership.js'
import { capHistory, type TutorTurn } from '../../lib/tutor/tutor.js'
import { olderThanTtl, recoverStaleTurn } from './stale-turn.js'
import type { AiApi } from '../../services/ai/index.js'
import type { TopicApi } from '../topic/index.js'

export const DEFAULT_TOPIC_ID = 'other'
export const DEFAULT_TITLE = 'New thread'
export const DEFAULT_PAGE_SIZE = 20

export type ThreadDto = {
  id: string
  topicId: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export type MessageDto = {
  id: string
  threadId: string
  role: MessageRow['role']
  content: string
  status: MessageRow['status']
  stopReason: MessageRow['stop_reason']
  createdAt: string
}

export type ThreadDetailDto = {
  thread: ThreadDto
  messages: MessageDto[]
  /** The contract's GuideSummary, newest first. */
  guides: {
    id: string
    title: string
    stepCount: number
    doneCount: number
    createdAt: string
  }[]
  /** The contract's QuizSummary, newest first. */
  quizzes: {
    id: string
    difficulty: 'easy' | 'medium' | 'hard'
    itemCount: number
    bestScore: number | null
    createdAt: string
  }[]
}

type ThreadRecord = {
  id: string
  topic_id: string
  title: string
  created_at: Date
  updated_at: Date
  message_count: number
}

/** Messages that count toward the thread: failed turns do not (ledger ruling 14). */
const messageCountExpr = sql<number>`(
  SELECT count(*)::int FROM message
  WHERE message.thread_id = thread.id AND message.status <> 'failed'
)`

function toThreadDto(row: ThreadRecord): ThreadDto {
  return {
    id: row.id,
    topicId: row.topic_id,
    title: row.title,
    messageCount: row.message_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }
}

function toMessageDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    status: row.status,
    stopReason: row.stop_reason,
    createdAt: row.created_at.toISOString()
  }
}

/** A live (not deleted) thread owned by the user, with its message count. 404 otherwise. */
async function loadThread(db: Db, auth: Auth, id: string): Promise<ThreadRecord> {
  const row = await db
    .selectFrom('thread')
    .select([
      'thread.id',
      'thread.topic_id',
      'thread.title',
      'thread.created_at',
      'thread.updated_at',
      messageCountExpr.as('message_count')
    ])
    .where('thread.id', '=', id)
    .where(ownedBy('thread', auth))
    .where('thread.deleted_at', 'is', null)
    .executeTakeFirst()
  return requireFound(row)
}

type Cursor = { u: string; i: string }
// ISO-8601 UTC with up to microsecond precision, the precision Postgres stores.
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/

// Ids are UUIDv7 text; accept any id of sane length without NUL (Postgres 22021).
const MAX_CURSOR_ID = 64

/** True when the cursor time is a real calendar instant (month 13 and Feb 30 do not round-trip). */
function isRealTimestamp(value: string): boolean {
  const ms = Date.parse(value)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19)
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function invalidCursor() {
  return badRequest('validation_failed', 'The request is invalid.', {
    issues: [{ path: ['cursor'], message: 'Invalid cursor' }]
  })
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'u' in parsed && 'i' in parsed) {
      const { u, i } = parsed
      if (
        typeof u === 'string' &&
        typeof i === 'string' &&
        CURSOR_TIME.test(u) &&
        isRealTimestamp(u) &&
        i !== '' &&
        i.length <= MAX_CURSOR_ID &&
        hasNoNul(i)
      ) {
        return { u, i }
      }
    }
  } catch {
    // fall through to the 400 below
  }
  throw invalidCursor()
}

async function buildHistory(db: Db, auth: Auth, threadId: string): Promise<TutorTurn[]> {
  const rows = await db
    .selectFrom('message')
    .select(['role', 'content'])
    .where('thread_id', '=', threadId)
    .where(ownedBy('message', auth))
    .where('status', '<>', 'failed')
    .orderBy('created_at')
    .orderBy('id')
    .execute()
  return capHistory(rows.filter((row) => row.role === 'user' || row.content !== ''))
}

/** A live thread owned by the user, as other modules see it. */
export type ThreadSummary = { id: string; topicId: string; title: string; messageCount: number }

export type ThreadServiceDeps = { db: Db; topic: TopicApi; ai: AiApi }

export type ThreadService = {
  list(
    auth: Auth,
    input: { cursor?: string | undefined; limit?: number | undefined }
  ): Promise<{ threads: ThreadDto[]; nextCursor: string | null }>
  create(
    auth: Auth,
    input: { topicId?: string | undefined; title?: string | undefined }
  ): Promise<ThreadDto>
  getDetail(auth: Auth, id: string): Promise<ThreadDetailDto>
  update(
    auth: Auth,
    id: string,
    input: { title?: string | undefined; topicId?: string | undefined }
  ): Promise<ThreadDto>
  /** Soft delete: afterwards every read and write on the thread is a 404. */
  delete(auth: Auth, id: string): Promise<void>
  /**
   * Throws 404 unless the thread exists, is owned by the user and is not deleted. Returns the
   * thread's topic id and title for callers that need them.
   */
  require(auth: Auth, id: string): Promise<ThreadSummary>
  /** The thread needs at least one answer to build a guide or quiz from (409 `thread_empty`). */
  assertHasAnswer(auth: Auth, id: string): Promise<void>
  /**
   * Earlier turns, oldest first, as the model should see them. Failed turns are left out (on
   * failure both messages of the turn are `failed`), and so are assistant messages with no text.
   * `incomplete` answers are sent as they are.
   */
  history(auth: Auth, threadId: string): Promise<TutorTurn[]>
  /** System-wide sweep of turns left in flight by a crash. Boot only. */
  recoverStaleAtBoot(): Promise<number>
}

/** What other modules may call. */
export type ThreadApi = Pick<ThreadService, 'require' | 'assertHasAnswer' | 'history'>

export function createThreadService({ db, topic: topicApi, ai }: ThreadServiceDeps): ThreadService {
  return {
    async list(auth, input) {
      const limit = input.limit ?? DEFAULT_PAGE_SIZE
      const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
      let query = db
        .selectFrom('thread')
        .select([
          'thread.id',
          'thread.topic_id',
          'thread.title',
          'thread.created_at',
          'thread.updated_at',
          // The cursor carries Postgres' microsecond precision; a JS Date would truncate it and
          // make a row reappear on the next page.
          sql<string>`to_char(thread.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
            'updated_at_iso'
          ),
          messageCountExpr.as('message_count')
        ])
        .where(ownedBy('thread', auth))
        .where('thread.deleted_at', 'is', null)
      if (cursor) {
        query = query.where(
          sql<boolean>`(thread.updated_at, thread.id) < (${cursor.u}::timestamptz, ${cursor.i})`
        )
      }
      const rows = await query
        .orderBy('thread.updated_at', 'desc')
        .orderBy('thread.id', 'desc')
        .limit(limit + 1)
        .execute()
      const page = rows.slice(0, limit)
      const last = page[page.length - 1]
      return {
        threads: page.map(toThreadDto),
        nextCursor:
          rows.length > limit && last ? encodeCursor({ u: last.updated_at_iso, i: last.id }) : null
      }
    },
    async create(auth, input) {
      const topic = await topicApi.require(input.topicId ?? DEFAULT_TOPIC_ID)
      const row = await db
        .insertInto('thread')
        .values({
          user_id: auth.userId,
          topic_id: topic.id,
          title: input.title ?? DEFAULT_TITLE
        })
        .returning(['id', 'topic_id', 'title', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow()
      return toThreadDto({ ...row, message_count: 0 })
    },
    async getDetail(auth, id) {
      let thread = await loadThread(db, auth, id)
      // Recover a turn a crash left in flight, so the page never shows it pending for ever.
      if (
        (await recoverStaleTurn(db, olderThanTtl(ai.lockTtlSeconds), {
          auth,
          threadId: thread.id
        })) > 0
      ) {
        thread = await loadThread(db, auth, id)
      }
      const messages = await db
        .selectFrom('message')
        .selectAll()
        .where('thread_id', '=', thread.id)
        .where(ownedBy('message', auth))
        .orderBy('created_at')
        .orderBy('id')
        .execute()
      return {
        thread: toThreadDto(thread),
        messages: messages.map(toMessageDto),
        guides: (
          await db
            .selectFrom('guide')
            .select([
              'guide.id',
              'guide.title',
              'guide.created_at',
              sql<number>`(SELECT count(*)::int FROM guide_step WHERE guide_step.guide_id = guide.id)`.as(
                'step_count'
              ),
              sql<number>`(
            SELECT count(*)::int FROM guide_step
            WHERE guide_step.guide_id = guide.id AND guide_step.done_at IS NOT NULL
          )`.as('done_count')
            ])
            .where('guide.thread_id', '=', thread.id)
            .where(ownedBy('guide', auth))
            .orderBy('guide.created_at', 'desc')
            .orderBy('guide.id', 'desc')
            .execute()
        ).map((row) => ({
          id: row.id,
          title: row.title,
          stepCount: row.step_count,
          doneCount: row.done_count,
          createdAt: row.created_at.toISOString()
        })),
        quizzes: (
          await db
            .selectFrom('quiz')
            .select([
              'quiz.id',
              'quiz.difficulty',
              'quiz.created_at',
              sql<number>`(SELECT count(*)::int FROM quiz_item WHERE quiz_item.quiz_id = quiz.id)`.as(
                'item_count'
              ),
              sql<number | null>`(
            SELECT max(quiz_attempt.score) FROM quiz_attempt WHERE quiz_attempt.quiz_id = quiz.id
          )`.as('best_score')
            ])
            .where('quiz.thread_id', '=', thread.id)
            .where(ownedBy('quiz', auth))
            .orderBy('quiz.created_at', 'desc')
            .orderBy('quiz.id', 'desc')
            .execute()
        ).map((row) => ({
          id: row.id,
          difficulty: row.difficulty,
          itemCount: row.item_count,
          bestScore: row.best_score,
          createdAt: row.created_at.toISOString()
        }))
      }
    },
    async update(auth, id, input) {
      const topicId =
        input.topicId === undefined ? undefined : (await topicApi.require(input.topicId)).id
      const changes = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(topicId !== undefined ? { topic_id: topicId } : {})
      }
      if (Object.keys(changes).length > 0) {
        const updated = await db
          .updateTable('thread')
          .set(changes)
          .where('id', '=', id)
          .where(ownedBy('thread', auth))
          .where('deleted_at', 'is', null)
          .returning('id')
          .executeTakeFirst()
        requireFound(updated)
      }
      return toThreadDto(await loadThread(db, auth, id))
    },
    async delete(auth, id) {
      const deleted = await db
        .updateTable('thread')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', '=', id)
        .where(ownedBy('thread', auth))
        .where('deleted_at', 'is', null)
        .returning('id')
        .executeTakeFirst()
      requireFound(deleted)
    },
    async require(auth, id) {
      const row = await loadThread(db, auth, id)
      return {
        id: row.id,
        topicId: row.topic_id,
        title: row.title,
        messageCount: row.message_count
      }
    },
    async assertHasAnswer(auth, threadId) {
      const row = await db
        .selectFrom('message')
        .select('id')
        .where('thread_id', '=', threadId)
        .where(ownedBy('message', auth))
        .where('role', '=', 'assistant')
        .where('status', '=', 'complete')
        .limit(1)
        .executeTakeFirst()
      if (!row) {
        throw conflict(
          'thread_empty',
          'Ask a question first, then build a guide or quiz from the answer.'
        )
      }
    },
    history: (auth, threadId) => buildHistory(db, auth, threadId),
    recoverStaleAtBoot: () => recoverStaleTurn(db, sql<Date>`now()`)
  }
}
