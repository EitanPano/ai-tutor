import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCreateQuiz } from '@/component/quiz/use-create-quiz'
import { ApiError } from '@/lib/api/error'
import { quizKey } from '@/lib/api/quiz'
import { threadKey } from '@/lib/api/thread'

const api = vi.hoisted(() => ({ createQuiz: vi.fn() }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('@/lib/api/quiz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/quiz')>()),
  createQuiz: api.createQuiz
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

afterEach(() => {
  vi.clearAllMocks()
})

const quiz = (threadId: string | null) => ({
  quiz: {
    id: 'q1',
    threadId,
    topicId: 'react',
    difficulty: 'easy',
    createdAt: '',
    items: [],
    attempts: []
  }
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, invalidate, ...renderHook(() => useCreateQuiz(), { wrapper }) }
}

describe('useCreateQuiz', () => {
  it('opens the new quiz and refreshes the thread that lists it', async () => {
    api.createQuiz.mockResolvedValue(quiz('t1'))
    const { result, client, invalidate } = setup()

    act(() => result.current.create({ threadId: 't1' }))

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q1'))
    expect(api.createQuiz).toHaveBeenCalledWith({ threadId: 't1' })
    expect(client.getQueryData(quizKey.detail('q1'))).toEqual(quiz('t1'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: threadKey.detail('t1') })
  })

  it('stays busy after the quiz is written, while the page changes', async () => {
    api.createQuiz.mockResolvedValue(quiz('t1'))
    const { result } = setup()

    act(() => result.current.create({ threadId: 't1' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q1'))

    expect(result.current.isPending).toBe(true)
  })

  it('serves a quiz on a topic, which has no thread to refresh', async () => {
    api.createQuiz.mockResolvedValue(quiz(null))
    const { result, invalidate } = setup()

    act(() => result.current.create({ topicId: 'react', difficulty: 'hard' }))

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q1'))
    expect(api.createQuiz).toHaveBeenCalledWith({ topicId: 'react', difficulty: 'hard' })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('toasts a retryable failure whose Retry asks for the same quiz again', async () => {
    api.createQuiz.mockRejectedValueOnce(
      new ApiError({ status: 502, code: 'ai_invalid_output', message: 'x' })
    )
    api.createQuiz.mockResolvedValueOnce(quiz('t1'))
    const { result } = setup()

    act(() => result.current.create({ threadId: 't1', difficulty: 'hard' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const [message, options] = toast.error.mock.calls[0]!
    expect(message).toBe('The tutor produced something unusable. Try again.')
    expect(router.push).not.toHaveBeenCalled()

    act(() => options.action.onClick())
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q1'))
    expect(api.createQuiz).toHaveBeenLastCalledWith({ threadId: 't1', difficulty: 'hard' })
  })

  it('toasts a refusal without Retry and dismisses the toast when the page goes', async () => {
    api.createQuiz.mockRejectedValue(
      new ApiError({ status: 422, code: 'ai_refused', message: 'x' })
    )
    toast.error.mockReturnValue('toast-1')
    const { result, unmount } = setup()

    act(() => result.current.create({ threadId: 't1' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0]![1].action).toBeUndefined()

    unmount()
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
  })
})
