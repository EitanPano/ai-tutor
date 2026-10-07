import type { Db } from '../../lib/db/index.js'
import { badRequest } from '../../lib/error.js'

export type TopicDto = { id: string; name: string }

/** Reference data, not tenant data: no ownership scoping. */
export async function listTopics(db: Db): Promise<TopicDto[]> {
  return db.selectFrom('topic').select(['id', 'name']).orderBy('position').execute()
}

/** Returns the topic, or throws 400 `validation_failed` pointing at `topicId`. */
export async function requireTopic(db: Db, id: string): Promise<TopicDto> {
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
