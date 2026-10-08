import type { components } from '@/types/api'
import { apiFetch } from './client'

export type Difficulty = components['schemas']['Difficulty']
export type Quiz = components['schemas']['Quiz']
export type QuizItem = components['schemas']['QuizItem']
export type QuizSummary = components['schemas']['QuizSummary']
export type Attempt = components['schemas']['Attempt']
export type GradedItem = components['schemas']['GradedItem']
export type CreateQuizRequest = components['schemas']['CreateQuizRequest']
type QuizResponse = components['schemas']['QuizResponse']
type AttemptResponse = components['schemas']['AttemptResponse']
type SubmitAttemptRequest = components['schemas']['SubmitAttemptRequest']

export const quizKey = {
  all: ['quiz'] as const,
  detail: (id: string) => ['quiz', 'detail', id] as const,
  attempt: (quizId: string, attemptId: string) => ['quiz', 'attempt', quizId, attemptId] as const
}

export const createQuiz = (body: CreateQuizRequest) =>
  apiFetch<QuizResponse>('/api/quiz', { method: 'POST', body })

export const getQuiz = (id: string, signal?: AbortSignal) =>
  apiFetch<QuizResponse>(`/api/quiz/${encodeURIComponent(id)}`, { signal })

export const submitAttempt = (quizId: string, answers: SubmitAttemptRequest['answers']) =>
  apiFetch<AttemptResponse>(`/api/quiz/${encodeURIComponent(quizId)}/attempt`, {
    method: 'POST',
    body: { answers }
  })

export const getAttempt = (quizId: string, attemptId: string, signal?: AbortSignal) =>
  apiFetch<AttemptResponse>(
    `/api/quiz/${encodeURIComponent(quizId)}/attempt/${encodeURIComponent(attemptId)}`,
    { signal }
  )
