import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudyTools } from '@/component/thread/study-tools'
import { ApiError } from '@/lib/api/error'
import type { GuideSummary } from '@/lib/api/guide'
import type { QuizSummary } from '@/lib/api/quiz'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({ createGuide: vi.fn(), createQuiz: vi.fn() }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('@/lib/api/guide', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/guide')>()),
  createGuide: api.createGuide
}))
vi.mock('@/lib/api/quiz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/quiz')>()),
  createQuiz: api.createQuiz
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

afterEach(() => {
  vi.clearAllMocks()
})

const summary = (id: string, title: string, doneCount: number): GuideSummary => ({
  id,
  title,
  stepCount: 5,
  doneCount,
  createdAt: '2026-10-06T10:00:00Z'
})

const quizSummary = (
  id: string,
  difficulty: QuizSummary['difficulty'],
  bestScore: number | null
): QuizSummary => ({
  id,
  difficulty,
  itemCount: 5,
  bestScore,
  createdAt: '2026-10-06T10:00:00Z'
})

function setup(props: Partial<Parameters<typeof StudyTools>[0]> = {}) {
  renderWithQuery(
    <StudyTools threadId="t1" hasAnswer busy={false} guides={[]} quizzes={[]} {...props} />
  )
  return userEvent.setup()
}

describe('StudyTools guide action', () => {
  it('is disabled with a visible reason until there is an answer', () => {
    setup({ hasAnswer: false })

    const button = screen.getByRole('button', { name: 'Guide me step by step' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Ask a question first')
    expect(screen.getByText('Ask a question first')).toBeVisible()
  })

  it('waits while an answer is being written', () => {
    setup({ busy: true })

    expect(screen.getByRole('button', { name: 'Guide me step by step' })).toBeDisabled()
    expect(screen.getByText('Wait for the answer to finish')).toBeVisible()
  })

  it('shows the writing state, then opens the new guide', async () => {
    let finish!: (value: unknown) => void
    api.createGuide.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Guide me step by step' }))

    const busy = await screen.findByRole('button', { name: 'Writing your guide…' })
    expect(busy).toBeDisabled()
    expect(api.createGuide).toHaveBeenCalledWith('t1')

    finish({
      guide: { id: 'g9', threadId: 't1', topicId: 'react', title: 'x', createdAt: '', steps: [] }
    })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/guide/g9'))
  })

  it('stays busy after the guide is written, while the page changes', async () => {
    api.createGuide.mockResolvedValue({
      guide: { id: 'g9', threadId: 't1', topicId: 'react', title: 'x', createdAt: '', steps: [] }
    })
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Guide me step by step' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/guide/g9'))

    // The route has not changed yet in this test, as in the browser right after router.push.
    const busy = screen.getByRole('button', { name: 'Writing your guide…' })
    expect(busy).toBeDisabled()
    await typist.click(busy)
    expect(api.createGuide).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Quiz me' })).toBeDisabled()
  })

  it('toasts a retryable failure with Retry that asks again', async () => {
    api.createGuide.mockRejectedValue(
      new ApiError({ status: 502, code: 'ai_invalid_output', message: 'x' })
    )
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Guide me step by step' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const [message, options] = toast.error.mock.calls[0]!
    expect(message).toBe('The tutor produced something unusable. Try again.')
    expect(options.action.label).toBe('Retry')
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Guide me step by step' })).toBeEnabled()

    options.action.onClick()
    await waitFor(() => expect(api.createGuide).toHaveBeenCalledTimes(2))
  })

  it.each(['generation_in_progress', 'network_error'])('offers Retry on %s', async (code) => {
    api.createGuide.mockRejectedValue(new ApiError({ status: 409, code, message: 'x' }))
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Guide me step by step' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0]![1].action.label).toBe('Retry')
  })

  it.each([
    [422, 'ai_refused', "The tutor can't help with that question. Try rephrasing it."],
    [409, 'thread_empty', 'Ask a question first. A guide or quiz needs an answer to build on.']
  ])('toasts %i %s without a Retry', async (status, code, sentence) => {
    api.createGuide.mockRejectedValue(new ApiError({ status, code, message: 'x' }))
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Guide me step by step' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const [message, options] = toast.error.mock.calls[0]!
    expect(message).toBe(sentence)
    expect(options.action).toBeUndefined()
  })

  it('links the existing guides, newest first, with their progress', () => {
    setup({ guides: [summary('g2', 'Newer guide', 2), summary('g1', 'Older guide', 5)] })

    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Open guide: Newer guide (2 of 5 done)',
      'Open guide: Older guide (5 of 5 done)'
    ])
    expect(links[0]).toHaveAttribute('href', '/guide/g2')
  })
})

describe('StudyTools quiz action', () => {
  const quizResponse = (id: string) => ({
    quiz: {
      id,
      threadId: 't1',
      topicId: 'react',
      difficulty: 'hard',
      createdAt: '',
      items: [],
      attempts: []
    }
  })

  it('is disabled with the same visible reason until there is an answer', () => {
    setup({ hasAnswer: false })

    const button = screen.getByRole('button', { name: 'Quiz me' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Ask a question first')
    expect(screen.getByLabelText('Quiz difficulty')).toHaveValue('medium')
  })

  it('writes a medium quiz by default, then opens it', async () => {
    let finish!: (value: unknown) => void
    api.createQuiz.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Quiz me' }))

    const busy = await screen.findByRole('button', { name: 'Writing your quiz…' })
    expect(busy).toBeDisabled()
    // The guide waits: two generations at once would only race each other.
    expect(screen.getByRole('button', { name: 'Guide me step by step' })).toBeDisabled()
    expect(api.createQuiz).toHaveBeenCalledWith({ threadId: 't1', difficulty: 'medium' })

    finish(quizResponse('q9'))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q9'))
  })

  it('stays busy after the quiz is written, while the page changes', async () => {
    api.createQuiz.mockResolvedValue(quizResponse('q9'))
    const typist = setup()

    await typist.click(screen.getByRole('button', { name: 'Quiz me' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q9'))

    const busy = screen.getByRole('button', { name: 'Writing your quiz…' })
    expect(busy).toBeDisabled()
    await typist.click(busy)
    expect(api.createQuiz).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Guide me step by step' })).toBeDisabled()
  })

  it('asks for the chosen difficulty', async () => {
    api.createQuiz.mockResolvedValue(quizResponse('q9'))
    const typist = setup()

    await typist.selectOptions(screen.getByLabelText('Quiz difficulty'), 'Hard')
    await typist.click(screen.getByRole('button', { name: 'Quiz me' }))

    await waitFor(() =>
      expect(api.createQuiz).toHaveBeenCalledWith({ threadId: 't1', difficulty: 'hard' })
    )
  })

  it('lists the existing quizzes, newest first, with their best score', () => {
    setup({ quizzes: [quizSummary('q2', 'medium', 4), quizSummary('q1', 'hard', null)] })

    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Medium quiz, best 4 of 5',
      'Hard quiz, not taken yet'
    ])
    expect(links[0]).toHaveAttribute('href', '/quiz/q2')
  })
})
