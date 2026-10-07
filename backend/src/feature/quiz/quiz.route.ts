import { Router, type RequestHandler } from 'express'
import { pathParam } from '../../lib/validation.js'
import type { Db } from '../../lib/db/index.js'
import type { TutorProvider } from '../../lib/tutor/tutor.js'
import type { AiApi } from '../ai/index.js'
import {
  createQuiz,
  getAttempt,
  getQuiz,
  submitAttempt,
  type CreateQuizInput
} from './quiz.service.js'
import { getAuth } from '../../http/get-auth.js'
import { pathId } from '../../http/path-id.js'
import type { TopicApi } from '../topic/index.js'
import { createQuizSchema, submitAttemptSchema } from './quiz.schema.js'

export function quizRouter(
  db: Db,
  requireSession: RequestHandler,
  tutor: TutorProvider,
  topic: TopicApi,
  ai: AiApi
): Router {
  const router = Router()

  router.post('/api/quiz', requireSession, async (req, res) => {
    // The AI switch is the first check, before the body is looked at.
    ai.assertEnabled()
    const input: CreateQuizInput = createQuizSchema.parse(req.body)
    const quiz = await createQuiz(db, getAuth(req), { tutor, topic, ai }, input)
    res.status(201).json({ quiz })
  })

  router.get('/api/quiz/:id', requireSession, async (req, res) => {
    res.json({ quiz: await getQuiz(db, getAuth(req), pathId(req)) })
  })

  router.post('/api/quiz/:id/attempt', requireSession, async (req, res) => {
    const input = submitAttemptSchema.parse(req.body)
    const attempt = await submitAttempt(db, getAuth(req), pathId(req), input)
    res.status(201).json({ attempt })
  })

  router.get('/api/quiz/:id/attempt/:attemptId', requireSession, async (req, res) => {
    const attemptId = pathParam(req.params.attemptId)
    res.json({ attempt: await getAttempt(db, getAuth(req), pathId(req), attemptId) })
  })

  return router
}
