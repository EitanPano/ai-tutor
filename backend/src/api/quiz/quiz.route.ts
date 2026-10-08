import { Router, type RequestHandler } from 'express'
import { pathParam } from '../../lib/validation.js'
import type { AiApi } from '../../services/ai/index.js'
import type { CreateQuizInput, QuizService } from './quiz.service.js'
import { getAuth } from '../../middleware/auth.js'
import { pathId } from '../../http/path-id.js'
import { createQuizSchema, submitAttemptSchema } from './quiz.schema.js'

export function quizRouter(
  service: QuizService,
  { requireSession, ai }: { requireSession: RequestHandler; ai: AiApi }
): Router {
  const router = Router()

  router.post('/api/quiz', requireSession, async (req, res) => {
    // The AI switch is the first check, before the body is looked at.
    ai.assertEnabled()
    const input: CreateQuizInput = createQuizSchema.parse(req.body)
    const quiz = await service.create(getAuth(req), input)
    res.status(201).json({ quiz })
  })

  router.get('/api/quiz/:id', requireSession, async (req, res) => {
    res.json({ quiz: await service.get(getAuth(req), pathId(req)) })
  })

  router.post('/api/quiz/:id/attempt', requireSession, async (req, res) => {
    const input = submitAttemptSchema.parse(req.body)
    const attempt = await service.submitAttempt(getAuth(req), pathId(req), input)
    res.status(201).json({ attempt })
  })

  router.get('/api/quiz/:id/attempt/:attemptId', requireSession, async (req, res) => {
    const attemptId = pathParam(req.params.attemptId)
    res.json({ attempt: await service.getAttempt(getAuth(req), pathId(req), attemptId) })
  })

  return router
}
