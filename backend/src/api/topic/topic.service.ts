import type { Db } from '../../lib/db/index.js'
import { badRequest } from '../../lib/error.js'

export type TopicDto = { id: string; name: string }

export type TopicServiceDeps = { db: Db }

export type TopicService = {
  /** Reference data, not tenant data: no ownership scoping. */
  list(): Promise<TopicDto[]>
  /** Returns the topic, or throws 400 `validation_failed` pointing at `topicId`. */
  require(id: string): Promise<TopicDto>
}

export function createTopicService({ db }: TopicServiceDeps): TopicService {
  return {
    async list() {
      return db.selectFrom('topic').select(['id', 'name']).orderBy('position').execute()
    },
    async require(id) {
      const topic = await db
        .selectFrom('topic')
        .select(['id', 'name'])
        .where('id', '=', id)
        .executeTakeFirst()
      if (!topic) {
        throw badRequest('validation_failed', 'The request is invalid.', {
          issues: [{ path: ['topicId'], message: 'Unknown topic' }]
        })
      }
      return topic
    }
  }
}
