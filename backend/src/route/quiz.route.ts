import { Router } from 'express'
import { z } from 'zod'
import type { Config } from '../lib/config.js'
import type { Db } from '../lib/db/index.js'
import type { Logger } from '../lib/logger.js'
import type { TutorProvider } from '../lib/tutor/tutor.js'
import { assertAiEnabled } from '../service/ai-guard.js'
import {
  createQuiz,
  getAttempt,
  getQuiz,
  submitAttempt,
  type CreateQuizInput
} from '../service/quiz.service.js'
import { getAuth } from './middleware/get-auth.js'
import { pathId } from './middleware/path-id.js'
import { requireSession } from './middleware/require-session.js'

const difficulty = z.enum(['easy', 'medium', 'hard'])

// Mirrors CreateQuizRequest in .orchestrate/api-contract.yaml: exactly one of `threadId`
// (optional difficulty) or `topicId` (difficulty required).
const createQuizSchema = z.union([
  z.strictObject({ threadId: z.string().min(1), difficulty: difficulty.optional() }),
  z.strictObject({ topicId: z.string().min(1), difficulty })
])

// Mirrors SubmitAttemptRequest. The service checks the ids against the quiz.
const submitAttemptSchema = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        itemId: z.string().min(1),
        choiceIndex: z.number().int().min(0).max(3)
      })
    )
    .max(5)
})

export function quizRouter(
  db: Db,
  config: Config,
  tutor: TutorProvider,
  logger: Pick<Logger, 'error'>
): Router {
  const router = Router()
  const session = requireSession(db, config)

  router.post('/api/quiz', session, async (req, res) => {
    // The AI switch is the first check, before the body is looked at.
    assertAiEnabled(config)
    const input: CreateQuizInput = createQuizSchema.parse(req.body)
    const quiz = await createQuiz(db, getAuth(req), { config, tutor, logger }, input)
    res.status(201).json({ quiz })
  })

  router.get('/api/quiz/:id', session, async (req, res) => {
    res.json({ quiz: await getQuiz(db, getAuth(req), pathId(req)) })
  })

  router.post('/api/quiz/:id/attempt', session, async (req, res) => {
    const input = submitAttemptSchema.parse(req.body)
    const attempt = await submitAttempt(db, getAuth(req), pathId(req), input)
    res.status(201).json({ attempt })
  })

  router.get('/api/quiz/:id/attempt/:attemptId', session, async (req, res) => {
    const attemptId = typeof req.params.attemptId === 'string' ? req.params.attemptId : ''
    res.json({ attempt: await getAttempt(db, getAuth(req), pathId(req), attemptId) })
  })

  return router
}
