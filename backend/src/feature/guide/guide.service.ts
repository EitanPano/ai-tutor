import { sql } from 'kysely'
import type { Db } from '../../lib/db/index.js'
import type { GuideRow, GuideStepRow } from '../../lib/db/schema.js'
import { GuideDraftSchema, type GuideDraft } from '../../lib/tutor/guide.schema.js'
import type { TutorProvider } from '../../lib/tutor/tutor.js'
import type { AiApi } from '../ai/index.js'
import { ownedBy, requireFound, type Auth } from '../../lib/ownership.js'
import type { ThreadApi } from '../thread/index.js'
import type { TopicApi } from '../topic/index.js'

export type GuideDeps = {
  tutor: TutorProvider
  topic: TopicApi
  ai: AiApi
  thread: ThreadApi
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

/**
 * Generates a guide from a thread. The provider call, its retry and the `ai_call` rows live in
 * `generateValidated`; the generation lock is always released here.
 */
export async function createGuide(
  db: Db,
  auth: Auth,
  deps: GuideDeps,
  threadId: string
): Promise<GuideDto> {
  const { tutor, ai } = deps
  ai.assertEnabled()
  const thread = await deps.thread.require(auth, threadId)
  await deps.thread.assertHasAnswer(auth, thread.id)
  await ai.assertWithinBudget(auth)
  const topic = await deps.topic.require(thread.topicId)
  const lockToken = await ai.acquireLock(auth)
  try {
    const history = await deps.thread.history(auth, thread.id)
    const draft = await ai.generateValidated(auth, {
      kind: 'guide',
      schema: GuideDraftSchema,
      call: () => tutor.generateGuide({ topicName: topic.name, history }),
      model: tutor.model,
      logContext: { threadId: thread.id }
    })
    return await saveGuide(db, auth, { threadId: thread.id, topicId: topic.id, draft })
  } finally {
    await ai.releaseLock(auth, lockToken)
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
      .innerJoin('thread', 'thread.id', 'guide.thread_id')
      .selectAll('guide')
      .where('guide.id', '=', id)
      .where(ownedBy('guide', auth))
      // Content derived from a soft-deleted thread is hidden like the thread.
      .where('thread.deleted_at', 'is', null)
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

/** A step whose guide's thread is not soft-deleted (derived content is hidden with the thread). */
const inLiveThread = sql<boolean>`EXISTS (
  SELECT 1 FROM guide
  JOIN thread ON thread.id = guide.thread_id
  WHERE guide.id = guide_step.guide_id AND thread.deleted_at IS NULL
)`

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
          .where(inLiveThread)
          .returningAll()
          .executeTakeFirst()
      : await db
          .selectFrom('guide_step')
          .selectAll()
          .where('id', '=', stepId)
          .where('guide_id', '=', guideId)
          .where(ownedBy('guide_step', auth))
          .where(inLiveThread)
          .executeTakeFirst()
  return toStepDto(requireFound(row))
}
