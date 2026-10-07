import { Router, type RequestHandler } from 'express'
import type { Db } from '../../lib/db/index.js'
import type { InFlightRegistry } from '../../lib/in-flight.js'
import type { Logger } from '../../lib/logger.js'
import type { Auth } from '../../lib/ownership.js'
import type { TutorProvider, TutorTurn } from '../../lib/tutor/tutor.js'
import type { AiApi } from '../ai/index.js'
import type { TopicApi } from '../topic/index.js'
import { createMessageService } from './message.service.js'
import { messageRouter } from './message.route.js'
import { recoverStaleTurn } from './stale-turn.js'
import { createThreadService, type ThreadSummary } from './thread.service.js'
import { threadRouter } from './thread.route.js'

/** What other modules may call. */
export type ThreadApi = {
  /** Throws 404 unless the thread exists, is owned by the user and is not deleted. */
  require(auth: Auth, id: string): Promise<ThreadSummary>
  /** 409 `thread_empty` unless the thread has at least one complete answer. */
  assertHasAnswer(auth: Auth, id: string): Promise<void>
  /** Earlier turns, oldest first, as the model should see them (failed turns left out). */
  history(auth: Auth, threadId: string): Promise<TutorTurn[]>
}

export type ThreadModuleDeps = {
  db: Db
  tutor: TutorProvider
  logger: Pick<Logger, 'error'>
  inFlight: InFlightRegistry
  requireSession: RequestHandler
  topic: TopicApi
  ai: AiApi
}

export function createThreadModule(deps: ThreadModuleDeps): {
  api: ThreadApi
  router: Router
  /** System-wide sweep of turns left in flight by a crash. Boot only. */
  recoverStale: () => Promise<number>
} {
  const { db, tutor, logger, inFlight, requireSession, topic, ai } = deps
  const thread = createThreadService({ db, topic, ai })
  const message = createMessageService({ db, topic, ai, thread, logger })
  const api: ThreadApi = {
    require: (auth, id) => thread.require(auth, id),
    assertHasAnswer: (auth, id) => thread.assertHasAnswer(auth, id),
    history: (auth, threadId) => message.history(auth, threadId)
  }
  const router = Router()
  router.use(threadRouter(thread, { requireSession }))
  router.use(messageRouter(message, { requireSession, ai, tutor, logger, inFlight }))
  return { api, router, recoverStale: () => recoverStaleTurn(db, ai.lockTtlSeconds) }
}
