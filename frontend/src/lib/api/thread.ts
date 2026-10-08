import type { components } from '@/types/api'
import { apiFetch } from './client'

export type Thread = components['schemas']['Thread']
export type Message = components['schemas']['Message']
export type ThreadDetailResponse = components['schemas']['ThreadDetailResponse']
type ThreadListResponse = components['schemas']['ThreadListResponse']
type ThreadResponse = components['schemas']['ThreadResponse']
type CreateThreadRequest = components['schemas']['CreateThreadRequest']
type UpdateThreadRequest = components['schemas']['UpdateThreadRequest']

/** Query keys: `all` is the prefix that invalidates the list and every detail at once. */
export const threadKey = {
  all: ['thread'] as const,
  list: ['thread', 'list'] as const,
  detail: (id: string) => ['thread', 'detail', id] as const
}

export const listThreads = ({ cursor, signal }: { cursor?: string; signal?: AbortSignal } = {}) =>
  apiFetch<ThreadListResponse>(
    `/api/thread${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    { signal }
  )

export const createThread = (input: CreateThreadRequest) =>
  apiFetch<ThreadResponse>('/api/thread', { method: 'POST', body: input })

export const getThread = (id: string, signal?: AbortSignal) =>
  apiFetch<ThreadDetailResponse>(`/api/thread/${encodeURIComponent(id)}`, { signal })

export const updateThread = (id: string, input: UpdateThreadRequest) =>
  apiFetch<ThreadResponse>(`/api/thread/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input
  })

export const deleteThread = (id: string) =>
  apiFetch<void>(`/api/thread/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** The server saves a turn as soon as it starts; until it finishes the answer is empty and unmarked. */
export const isPending = (message: Message) =>
  message.role === 'assistant' && message.status === 'incomplete' && message.stopReason === null
