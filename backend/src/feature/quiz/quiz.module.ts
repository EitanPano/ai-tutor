import type { RequestHandler, Router } from 'express'
import { quizRouter } from './quiz.route.js'
import { createQuizService, type QuizServiceDeps } from './quiz.service.js'

export type QuizModuleDeps = QuizServiceDeps & { requireSession: RequestHandler }

export function createQuizModule(deps: QuizModuleDeps): { router: Router } {
  const { requireSession, ...serviceDeps } = deps
  const service = createQuizService(serviceDeps)
  return { router: quizRouter(service, { requireSession }) }
}
