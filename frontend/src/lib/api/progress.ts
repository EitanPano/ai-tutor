import type { components } from '@/types/api'
import { apiFetch } from './client'

export type ProgressResponse = components['schemas']['ProgressResponse']
export type TopicProgress = components['schemas']['TopicProgress']
export type Activity = components['schemas']['Activity']

export const progressKey = ['progress'] as const

export const getProgress = (signal?: AbortSignal) =>
  apiFetch<ProgressResponse>('/api/progress', { signal })
