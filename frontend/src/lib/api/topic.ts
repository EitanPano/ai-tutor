import type { components } from '@/types/api'
import { apiFetch } from './client'

export type Topic = components['schemas']['Topic']
type TopicListResponse = components['schemas']['TopicListResponse']

export const listTopics = (signal?: AbortSignal) =>
  apiFetch<TopicListResponse>('/api/topic', { signal })
