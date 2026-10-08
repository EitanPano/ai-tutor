import type { Db } from '../../lib/db/index.js'
import type { QuizAttemptRow, QuizDifficulty, QuizRow } from '../../lib/db/schema.js'
import { unprocessable } from '../../lib/error.js'
import { QuizDraftSchema, type QuizDraft } from '../../lib/tutor/quiz.schema.js'
import type { TutorProvider } from '../../lib/tutor/tutor.js'
import type { AiApi } from '../../services/ai/index.js'
import { isQuizLive, ownedBy, requireFound, type Auth } from '../../lib/ownership.js'
import type { ThreadApi } from '../thread/index.js'
import type { TopicApi } from '../topic/index.js'

const DEFAULT_DIFFICULTY: QuizDifficulty = 'medium'

export type QuizServiceDeps = {
  db: Db
  tutor: TutorProvider
  topic: TopicApi
  ai: AiApi
  thread: ThreadApi
}

/** `{ threadId, difficulty? }` or `{ topicId, difficulty }`; the route validates the shape. */
export type CreateQuizInput =
  | { threadId: string; difficulty?: QuizDifficulty | undefined }
  | { topicId: string; difficulty: QuizDifficulty }

/** The taker view of an item. Has no `answerIndex` and no `explanation`, by construction. */
export type QuizItemDto = {
  id: string
  position: number
  prompt: string
  choices: string[]
}

export type AttemptSummaryDto = {
  id: string
  score: number
  total: number
  submittedAt: string
}

/** The taker view of a quiz (AC07): built only from `TAKER_ITEM_COLUMNS`. */
export type QuizDto = {
  id: string
  threadId: string | null
  topicId: string
  difficulty: QuizDifficulty
  createdAt: string
  items: QuizItemDto[]
  attempts: AttemptSummaryDto[]
}

export type GradedItemDto = {
  itemId: string
  position: number
  prompt: string
  choices: string[]
  choiceIndex: number
  answerIndex: number
  correct: boolean
  explanation: string
}

export type AttemptDto = {
  id: string
  quizId: string
  score: number
  total: number
  submittedAt: string
  items: GradedItemDto[]
}

/**
 * The only columns the taker view ever selects from `quiz_item`. `answer_index` and
 * `explanation` are deliberately absent: the answer key is excluded at the query, not stripped
 * from a full object.
 */
const TAKER_ITEM_COLUMNS = ['id', 'position', 'prompt', 'choice'] as const

type TakerItemRow = { id: string; position: number; prompt: string; choice: string[] }

function toQuizItemDto(row: TakerItemRow): QuizItemDto {
  return { id: row.id, position: row.position, prompt: row.prompt, choices: row.choice }
}

function toAttemptSummaryDto(
  row: Pick<QuizAttemptRow, 'id' | 'score' | 'total' | 'submitted_at'>
): AttemptSummaryDto {
  return {
    id: row.id,
    score: row.score,
    total: row.total,
    submittedAt: row.submitted_at.toISOString()
  }
}

function toQuizDto(
  row: QuizRow,
  items: TakerItemRow[],
  attempts: Pick<QuizAttemptRow, 'id' | 'score' | 'total' | 'submitted_at'>[]
): QuizDto {
  return {
    id: row.id,
    threadId: row.thread_id,
    topicId: row.topic_id,
    difficulty: row.difficulty,
    createdAt: row.created_at.toISOString(),
    items: items.map(toQuizItemDto),
    attempts: attempts.map(toAttemptSummaryDto)
  }
}

export type QuizService = {
  /**
   * Generates a quiz from a thread or from a topic. The provider call, its retry and the `ai_call`
   * rows live in `generateValidated`; the generation lock is always released here. The route checks
   * the AI switch first; `ai.withGenerationLock` checks it again as the backstop.
   */
  create(auth: Auth, input: CreateQuizInput): Promise<QuizDto>
  get(auth: Auth, id: string): Promise<QuizDto>
  /**
   * Grades an attempt on the server. The answered item ids must equal the quiz's item ids, each
   * exactly once; otherwise 422 `attempt_incomplete` lists what is missing, duplicated or unknown.
   */
  submitAttempt(
    auth: Auth,
    quizId: string,
    input: { answers: { itemId: string; choiceIndex: number }[] }
  ): Promise<AttemptDto>
  /** The attempt must belong to this quiz and to the user (and the quiz must be visible). */
  getAttempt(auth: Auth, quizId: string, attemptId: string): Promise<AttemptDto>
}

async function saveQuiz(
  db: Db,
  auth: Auth,
  input: { threadId: string | null; topicId: string; difficulty: QuizDifficulty; draft: QuizDraft }
): Promise<QuizDto> {
  return db.transaction().execute(async (trx) => {
    const quiz = await trx
      .insertInto('quiz')
      .values({
        user_id: auth.userId,
        thread_id: input.threadId,
        topic_id: input.topicId,
        difficulty: input.difficulty
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    const items = await trx
      .insertInto('quiz_item')
      .values(
        input.draft.items.map((item, index) => ({
          quiz_id: quiz.id,
          user_id: auth.userId,
          position: index + 1,
          prompt: item.prompt,
          choice: JSON.stringify(item.choices),
          answer_index: item.answerIndex,
          explanation: item.explanation
        }))
      )
      .returning([...TAKER_ITEM_COLUMNS])
      .execute()
    return toQuizDto(
      quiz,
      items.sort((a, b) => a.position - b.position),
      []
    )
  })
}

/**
 * A quiz owned by the user. One generated from a thread that was soft-deleted is hidden like
 * the thread; a topic-only quiz is unaffected. 404 otherwise.
 */
async function requireQuiz(db: Db, auth: Auth, id: string): Promise<QuizRow> {
  const row = await db
    .selectFrom('quiz')
    .leftJoin('thread', 'thread.id', 'quiz.thread_id')
    .selectAll('quiz')
    .where('quiz.id', '=', id)
    .where(ownedBy('quiz', auth))
    .where(isQuizLive)
    .executeTakeFirst()
  return requireFound(row)
}

type KeyedItem = {
  id: string
  position: number
  prompt: string
  choice: string[]
  answer_index: number
  explanation: string
}

/** Full items (with the answer key), only ever used to grade and to render a graded attempt. */
async function loadKeyedItems(db: Db, auth: Auth, quizId: string): Promise<KeyedItem[]> {
  return db
    .selectFrom('quiz_item')
    .select(['id', 'position', 'prompt', 'choice', 'answer_index', 'explanation'])
    .where('quiz_id', '=', quizId)
    .where(ownedBy('quiz_item', auth))
    .orderBy('position')
    .execute()
}

function toAttemptDto(
  attempt: Pick<QuizAttemptRow, 'id' | 'quiz_id' | 'score' | 'total' | 'submitted_at' | 'answer'>,
  items: KeyedItem[]
): AttemptDto {
  const chosen = new Map(attempt.answer.map((entry) => [entry.itemId, entry.choiceIndex]))
  return {
    id: attempt.id,
    quizId: attempt.quiz_id,
    score: attempt.score,
    total: attempt.total,
    submittedAt: attempt.submitted_at.toISOString(),
    items: items.map((item) => {
      const choiceIndex = chosen.get(item.id)
      // Grading stores one answer per item; a gap is corrupted data, not a contract value.
      if (choiceIndex === undefined) {
        throw new Error(`Attempt ${attempt.id} has no answer for item ${item.id}`)
      }
      return {
        itemId: item.id,
        position: item.position,
        prompt: item.prompt,
        choices: item.choice,
        choiceIndex,
        answerIndex: item.answer_index,
        correct: choiceIndex === item.answer_index,
        explanation: item.explanation
      }
    })
  }
}

export function createQuizService(deps: QuizServiceDeps): QuizService {
  const { db } = deps
  return {
    async create(auth, input) {
      const { tutor, ai } = deps
      const difficulty = input.difficulty ?? DEFAULT_DIFFICULTY
      let threadId: string | null = null
      let topic: { id: string; name: string }
      if ('threadId' in input) {
        const thread = await deps.thread.require(auth, input.threadId)
        await deps.thread.assertHasAnswer(auth, thread.id)
        threadId = thread.id
        topic = await deps.topic.require(thread.topicId)
      } else {
        topic = await deps.topic.require(input.topicId)
      }
      return ai.withGenerationLock(auth, async () => {
        const history = threadId === null ? null : await deps.thread.history(auth, threadId)
        const draft = await ai.generateValidated(auth, {
          kind: 'quiz',
          schema: QuizDraftSchema,
          call: () => tutor.generateQuiz({ topicName: topic.name, difficulty, history }),
          model: tutor.model,
          logContext: { topicId: topic.id }
        })
        return saveQuiz(db, auth, { threadId, topicId: topic.id, difficulty, draft })
      })
    },
    async get(auth, id) {
      const quiz = await requireQuiz(db, auth, id)
      const items = await db
        .selectFrom('quiz_item')
        .select([...TAKER_ITEM_COLUMNS])
        .where('quiz_id', '=', quiz.id)
        .where(ownedBy('quiz_item', auth))
        .orderBy('position')
        .execute()
      const attempts = await db
        .selectFrom('quiz_attempt')
        .select(['id', 'score', 'total', 'submitted_at'])
        .where('quiz_id', '=', quiz.id)
        .where(ownedBy('quiz_attempt', auth))
        .orderBy('submitted_at', 'desc')
        .orderBy('id', 'desc')
        .execute()
      return toQuizDto(quiz, items, attempts)
    },
    async submitAttempt(auth, quizId, input) {
      const quiz = await requireQuiz(db, auth, quizId)
      const items = await loadKeyedItems(db, auth, quiz.id)
      const itemIds = new Set(items.map((item) => item.id))
      const seen = new Set<string>()
      const duplicateItemIds: string[] = []
      const unknownItemIds: string[] = []
      for (const { itemId } of input.answers) {
        if (!itemIds.has(itemId)) unknownItemIds.push(itemId)
        else if (seen.has(itemId)) duplicateItemIds.push(itemId)
        else seen.add(itemId)
      }
      const missingItemIds = items.filter((item) => !seen.has(item.id)).map((item) => item.id)
      if (missingItemIds.length > 0 || duplicateItemIds.length > 0 || unknownItemIds.length > 0) {
        throw unprocessable('attempt_incomplete', 'Answer every quiz item exactly once.', {
          missingItemIds,
          ...(duplicateItemIds.length > 0 ? { duplicateItemIds } : {}),
          ...(unknownItemIds.length > 0 ? { unknownItemIds } : {})
        })
      }
      const chosen = new Map(input.answers.map((entry) => [entry.itemId, entry.choiceIndex]))
      const score = items.filter((item) => chosen.get(item.id) === item.answer_index).length
      const attempt = await db
        .insertInto('quiz_attempt')
        .values({
          quiz_id: quiz.id,
          user_id: auth.userId,
          answer: JSON.stringify(input.answers),
          score,
          total: items.length
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      return toAttemptDto(attempt, items)
    },
    async getAttempt(auth, quizId, attemptId) {
      const quiz = await requireQuiz(db, auth, quizId)
      const attempt = requireFound(
        await db
          .selectFrom('quiz_attempt')
          .selectAll()
          .where('id', '=', attemptId)
          .where('quiz_id', '=', quiz.id)
          .where(ownedBy('quiz_attempt', auth))
          .executeTakeFirst()
      )
      return toAttemptDto(attempt, await loadKeyedItems(db, auth, quiz.id))
    }
  }
}
