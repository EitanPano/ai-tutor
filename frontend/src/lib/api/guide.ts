import type { components } from '@/types/api'
import { apiFetch } from './client'

export type Guide = components['schemas']['Guide']
export type Step = components['schemas']['Step']
export type GuideSummary = components['schemas']['GuideSummary']
export type UpdateStepRequest = components['schemas']['UpdateStepRequest']
type GuideResponse = components['schemas']['GuideResponse']
type StepResponse = components['schemas']['StepResponse']

export const guideKey = {
  all: ['guide'] as const,
  detail: (id: string) => ['guide', 'detail', id] as const
}

export const createGuide = (threadId: string) =>
  apiFetch<GuideResponse>(`/api/thread/${encodeURIComponent(threadId)}/guide`, {
    method: 'POST'
  })

export const getGuide = (id: string, signal?: AbortSignal) =>
  apiFetch<GuideResponse>(`/api/guide/${encodeURIComponent(id)}`, { signal })

export const updateStep = (guideId: string, stepId: string, body: UpdateStepRequest) =>
  apiFetch<StepResponse>(
    `/api/guide/${encodeURIComponent(guideId)}/step/${encodeURIComponent(stepId)}`,
    { method: 'PATCH', body }
  )
