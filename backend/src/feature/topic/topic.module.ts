import type { Router } from 'express'
import type { Db } from '../../lib/db/index.js'
import { topicRouter } from './topic.route.js'
import { createTopicService, type TopicDto } from './topic.service.js'

/** What other modules may call. */
export type TopicApi = {
  /** Returns the topic, or throws 400 `validation_failed` pointing at `topicId`. */
  require(id: string): Promise<TopicDto>
}

export type TopicModuleDeps = { db: Db }

export function createTopicModule(deps: TopicModuleDeps): { api: TopicApi; router: Router } {
  const service = createTopicService(deps)
  return { api: service, router: topicRouter(service) }
}
