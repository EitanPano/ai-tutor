import { sql } from 'kysely'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import type { GuideRow, GuideStepRow } from '../lib/db/schema.js'
import { badGateway, conflict, unprocessable } from '../lib/error.js'
import type { Logger } from '../lib/logger.js'
import { GuideDraftSchema, type GuideDraft } from '../lib/tutor/guide.schema.js'
import type { TutorProvider } from '../lib/tutor/tutor.js'
import { ZERO_USAGE } from '../lib/tutor/tutor.js'
import { assertWithinBudget, recordAiCall } from './ai-budget.js'
import { assertAiEnabled } from './ai-guard.js'
import { buildHistory } from './ask.service.js'
import { acquireGenerationLock, releaseGenerationLock } from './generation-lock.js'
import { ownedBy, requireFound, type Auth } from './ownership.js'
import { requireThread } from './thread.service.js'
import { requireTopic } from './topic.service.js'

/** One attempt plus one retry when the output is unusable. */
const MAX_ATTEMPTS = 2

export type GuideDeps = {
  config: Pick<Config, 'aiEnabled' | 'aiDailyTokenBudget'>
  tutor: TutorProvider
  logger: Pick<Logger, 'error'>
}

export type StepDto = {
  id: string
  position: number
  title: string
  body: string
  code: string | null
  codeLanguage: string | null
  hint: string
  hintRevealedAt: string | null
  doneAt: string | null
}

export type GuideDto = {
  id: string
  threadId: string
  topicId: string
  title: string
  createdAt: string
  steps: StepDto[]
}

export function toStepDto(row: GuideStepRow): StepDto {
  return {
    id: row.id,
    position: row.position,
    title: row.title,
    body: row.body,
    code: row.code,
    codeLanguage: row.code_language,
    hint: row.hint,
    hintRevealedAt: row.hint_revealed_at ? row.hint_revealed_at.toISOString() : null,
    doneAt: row.done_at ? row.done_at.toISOString() : null
  }
}

export function toGuideDto(row: GuideRow, steps: GuideStepRow[]): GuideDto {
  return {
    id: row.id,
    threadId: row.thread_id,
    topicId: row.topic_id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    steps: steps.map(toStepDto)
  }
}

/** The thread needs at least one answer to build a guide from. */
async function assertHasAnswer(db: Db, auth: Auth, threadId: string): Promise<void> {
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
    throw conflict('thread_empty', 'Ask a question first, then turn the answer into a guide.')
  }
}

/**
 * Generates a guide from a thread. Every provider call is recorded in `ai_call`, independently of
 * the persistence transaction, and the generation lock is always released. Unusable output (a
 * truncation or a draft that fails the schema) is retried once; a refusal or a provider error is
 * not retried (the SDK already retries transient errors).
 */
export async function createGuide(
  db: Db,
  auth: Auth,
  deps: GuideDeps,
  threadId: string
): Promise<GuideDto> {
  const { config, tutor, logger } = deps
  assertAiEnabled(config)
  const thread = await requireThread(db, auth, threadId)
  await assertHasAnswer(db, auth, thread.id)
  await assertWithinBudget(db, auth, config.aiDailyTokenBudget)
  const topic = await requireTopic(db, thread.topicId)
  const lockToken = await acquireGenerationLock(db, auth)
  try {
    const history = await buildHistory(db, auth, thread.id)
    let draft: GuideDraft | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && draft === undefined; attempt += 1) {
      const startedAt = Date.now()
      let result
      try {
        result = await tutor.generateGuide({ topicName: topic.name, history })
      } catch (err) {
        // Never log the conversation or the model output, only the failure.
        logger.error({ err, threadId: thread.id }, 'guide generation failed')
        await recordCall(db, auth, logger, {
          model: tutor.model,
          stopReason: 'error',
          refusalCategory: null,
          usage: ZERO_USAGE,
          latencyMs: Date.now() - startedAt
        })
        throw badGateway('ai_provider_error', 'The AI service failed to answer. Retry in a moment.')
      }
      await recordCall(db, auth, logger, {
        model: result.model,
        stopReason: result.stopReason,
        refusalCategory: result.refusalCategory,
        usage: result.usage,
        latencyMs: Date.now() - startedAt
      })
      if (result.stopReason === 'refusal') {
        throw unprocessable('ai_refused', "The tutor can't help with that. Try rephrasing it.")
      }
      const parsed = GuideDraftSchema.safeParse(result.output)
      if (parsed.success) draft = parsed.data
    }
    if (draft === undefined) {
      throw badGateway('ai_invalid_output', 'The tutor produced an unusable guide. Try again.')
    }
    return await saveGuide(db, auth, { threadId: thread.id, topicId: topic.id, draft })
  } finally {
    await releaseGenerationLock(db, auth, lockToken)
  }
}

async function recordCall(
  db: Db,
  auth: Auth,
  logger: Pick<Logger, 'error'>,
  call: {
    model: string
    stopReason: string
    refusalCategory: string | null
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
    latencyMs: number
  }
): Promise<void> {
  try {
    await recordAiCall(db, auth, {
      kind: 'guide',
      model: call.model,
      input_token: call.usage.inputTokens,
      output_token: call.usage.outputTokens,
      cache_read_token: call.usage.cacheReadTokens,
      stop_reason: call.stopReason,
      refusal_category: call.refusalCategory,
      latency_ms: Math.max(0, Math.round(call.latencyMs))
    })
  } catch (err) {
    logger.error({ err }, 'recording the ai_call failed')
  }
}

async function saveGuide(
  db: Db,
  auth: Auth,
  input: { threadId: string; topicId: string; draft: GuideDraft }
): Promise<GuideDto> {
  return db.transaction().execute(async (trx) => {
    const guide = await trx
      .insertInto('guide')
      .values({
        user_id: auth.userId,
        thread_id: input.threadId,
        topic_id: input.topicId,
        title: input.draft.title
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    const steps = await trx
      .insertInto('guide_step')
      .values(
        input.draft.steps.map((step, index) => ({
          guide_id: guide.id,
          user_id: auth.userId,
          position: index + 1,
          title: step.title,
          body: step.body,
          code: step.code,
          code_language: step.code === null ? null : step.codeLanguage,
          hint: step.hint
        }))
      )
      .returningAll()
      .execute()
    return toGuideDto(
      guide,
      steps.sort((a, b) => a.position - b.position)
    )
  })
}

export async function getGuide(db: Db, auth: Auth, id: string): Promise<GuideDto> {
  const guide = requireFound(
    await db
      .selectFrom('guide')
      .selectAll()
      .where('id', '=', id)
      .where(ownedBy('guide', auth))
      .executeTakeFirst()
  )
  const steps = await db
    .selectFrom('guide_step')
    .selectAll()
    .where('guide_id', '=', guide.id)
    .where(ownedBy('guide_step', auth))
    .orderBy('position')
    .execute()
  return toGuideDto(guide, steps)
}

export async function updateStep(
  db: Db,
  auth: Auth,
  guideId: string,
  stepId: string,
  input: { done?: boolean | undefined; hintRevealed?: true | undefined }
): Promise<StepDto> {
  const changes = {
    ...(input.done === true ? { done_at: sql<Date>`coalesce(done_at, now())` } : {}),
    ...(input.done === false ? { done_at: null } : {}),
    ...(input.hintRevealed === true
      ? { hint_revealed_at: sql<Date>`coalesce(hint_revealed_at, now())` }
      : {})
  }
  const row =
    Object.keys(changes).length > 0
      ? await db
          .updateTable('guide_step')
          .set(changes)
          .where('id', '=', stepId)
          .where('guide_id', '=', guideId)
          .where(ownedBy('guide_step', auth))
          .returningAll()
          .executeTakeFirst()
      : await db
          .selectFrom('guide_step')
          .selectAll()
          .where('id', '=', stepId)
          .where('guide_id', '=', guideId)
          .where(ownedBy('guide_step', auth))
          .executeTakeFirst()
  return toStepDto(requireFound(row))
}
