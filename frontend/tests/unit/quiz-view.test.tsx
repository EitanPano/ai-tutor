import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuizView } from '@/component/quiz/quiz-view'
import { ApiError } from '@/lib/api/error'
import type { Quiz } from '@/lib/api/quiz'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({
  getQuiz: vi.fn(),
  submitAttempt: vi.fn(),
  listTopics: vi.fn()
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('@/lib/api/quiz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/quiz')>()),
  getQuiz: api.getQuiz,
  submitAttempt: api.submitAttempt
}))
vi.mock('@/lib/api/topic', () => ({ listTopics: api.listTopics }))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
// Highlighting is a nicety that loads Shiki: the plain block is enough here.
vi.mock('@/component/markdown/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>
}))

afterEach(() => {
  vi.clearAllMocks()
})

const quiz = (over: Partial<Quiz> = {}): Quiz => ({
  id: 'q1',
  threadId: 't1',
  topicId: 'react',
  difficulty: 'hard',
  createdAt: '2026-10-06T10:00:00Z',
  items: [1, 2, 3, 4, 5].map((n) => ({
    id: `i${n}`,
    position: n,
    prompt: `What does \`hook${n}\` do?`,
    choices: [0, 1, 2, 3].map((c) => `Choice ${n}.${c}`)
  })),
  attempts: [],
  ...over
})

function setup(data: Quiz = quiz()) {
  api.getQuiz.mockResolvedValue({ quiz: data })
  api.listTopics.mockResolvedValue({ topics: [{ id: 'react', name: 'React' }] })
  renderWithQuery(<QuizView quizId="q1" />)
  return userEvent.setup()
}

const submit = () => screen.getByRole('button', { name: 'Submit answers' })
const group = (n: number) => screen.getByRole('group', { name: new RegExp(`hook${n}`) })

async function answerAll(typist: ReturnType<typeof userEvent.setup>, picks = [3, 2, 1, 0, 3]) {
  for (const [i, pick] of picks.entries()) {
    await typist.click(within(group(i + 1)).getByLabelText(`Choice ${i + 1}.${pick}`))
  }
}

describe('QuizView', () => {
  it('titles the quiz with its difficulty and topic and links back to the thread', async () => {
    setup()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hard quiz on React' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to the conversation' })).toHaveAttribute(
      'href',
      '/thread/t1'
    )
  })

  it('links a topic quiz back to progress, with no thread to return to', async () => {
    setup(quiz({ threadId: null }))

    expect(await screen.findByRole('link', { name: 'Back to progress' })).toHaveAttribute(
      'href',
      '/progress'
    )
    expect(screen.queryByRole('link', { name: 'Back to the conversation' })).toBeNull()
  })

  it('shows five numbered items, each a group with four radios', async () => {
    setup()

    expect(await screen.findAllByRole('group')).toHaveLength(5)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(within(group(n)).getAllByRole('radio')).toHaveLength(4)
    }
    // The prompt renders as markdown: inline code is code, not backticks.
    expect(group(1).querySelector('code')).toHaveTextContent('hook1')
  })

  it('keeps Submit disabled until every item is answered, and counts as you go', async () => {
    const typist = setup()
    await screen.findAllByRole('group')

    expect(screen.getByText('0 of 5 answered')).toBeVisible()
    expect(submit()).toBeDisabled()

    await answerAll(typist, [3, 2, 1, 0])
    expect(screen.getByText('4 of 5 answered')).toBeVisible()
    expect(submit()).toBeDisabled()

    // Changing an answer does not count twice.
    await typist.click(within(group(1)).getByLabelText('Choice 1.0'))
    expect(screen.getByText('4 of 5 answered')).toBeVisible()
    expect(within(group(1)).getByLabelText('Choice 1.0')).toBeChecked()
    expect(within(group(1)).getByLabelText('Choice 1.3')).not.toBeChecked()

    await typist.click(within(group(5)).getByLabelText('Choice 5.3'))
    expect(screen.getByText('5 of 5 answered')).toBeVisible()
    expect(submit()).toBeEnabled()
  })

  it('lets the arrow keys move the choice within an item', async () => {
    const typist = setup()
    await screen.findAllByRole('group')

    await typist.click(within(group(2)).getByLabelText('Choice 2.0'))
    await typist.keyboard('{ArrowDown}')

    expect(within(group(2)).getByLabelText('Choice 2.1')).toBeChecked()
  })

  it('submits every answer and opens the review', async () => {
    api.submitAttempt.mockResolvedValue({
      attempt: { id: 'a1', quizId: 'q1', score: 5, total: 5, submittedAt: '', items: [] }
    })
    const typist = setup()
    await screen.findAllByRole('group')

    await answerAll(typist)
    await typist.click(submit())

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q1/attempt/a1'))
    expect(api.submitAttempt).toHaveBeenCalledWith('q1', [
      { itemId: 'i1', choiceIndex: 3 },
      { itemId: 'i2', choiceIndex: 2 },
      { itemId: 'i3', choiceIndex: 1 },
      { itemId: 'i4', choiceIndex: 0 },
      { itemId: 'i5', choiceIndex: 3 }
    ])
  })

  it('stays on Grading and ignores a second submit while the page changes', async () => {
    api.submitAttempt.mockResolvedValue({
      attempt: { id: 'a1', quizId: 'q1', score: 5, total: 5, submittedAt: '', items: [] }
    })
    const typist = setup()
    await screen.findAllByRole('group')

    await answerAll(typist)
    await typist.click(submit())
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q1/attempt/a1'))

    const grading = screen.getByRole('button', { name: 'Grading…' })
    expect(grading).toBeDisabled()
    await typist.click(grading)
    await typist.keyboard('{Enter}')
    expect(api.submitAttempt).toHaveBeenCalledTimes(1)
  })

  it('toasts a rejected submission, keeps the answers and returns focus to Submit', async () => {
    api.submitAttempt.mockRejectedValue(
      new ApiError({ status: 422, code: 'attempt_incomplete', message: 'x' })
    )
    const typist = setup()
    await screen.findAllByRole('group')

    await answerAll(typist)
    await typist.click(submit())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Answer every item before submitting.')
    )
    expect(router.push).not.toHaveBeenCalled()
    expect(submit()).toBeEnabled()
    await waitFor(() => expect(submit()).toHaveFocus())
    expect(within(group(1)).getByLabelText('Choice 1.3')).toBeChecked()
    expect(screen.getByText('5 of 5 answered')).toBeVisible()
  })

  it('lists past attempts, newest first, each linking to its review', async () => {
    setup(
      quiz({
        attempts: [
          { id: 'a2', score: 4, total: 5, submittedAt: '2026-10-06T12:00:00Z' },
          { id: 'a1', score: 3, total: 5, submittedAt: '2026-10-05T12:00:00Z' }
        ]
      })
    )

    const links = await screen.findAllByRole('link', { name: /^Attempt on / })
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringMatching(/^Attempt on .+: 4 of 5$/),
      expect.stringMatching(/^Attempt on .+: 3 of 5$/)
    ])
    expect(links[0]).toHaveAttribute('href', '/quiz/q1/attempt/a2')
  })

  it('says so when the quiz does not exist', async () => {
    api.getQuiz.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'x' }))
    api.listTopics.mockResolvedValue({ topics: [] })
    renderWithQuery(<QuizView quizId="gone" />)

    expect(await screen.findByText("This quiz doesn't exist or was deleted.")).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
  })

  it('offers Retry when the quiz fails to load', async () => {
    api.getQuiz.mockRejectedValueOnce(
      new ApiError({ status: 0, code: 'network_error', message: 'x' })
    )
    api.getQuiz.mockResolvedValue({ quiz: quiz() })
    api.listTopics.mockResolvedValue({ topics: [] })
    const typist = userEvent.setup()
    renderWithQuery(<QuizView quizId="q1" />)

    await typist.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findAllByRole('group')).toHaveLength(5)
  })

  it('titles the page after the quiz difficulty and topic once they load', async () => {
    setup(quiz({ difficulty: 'medium' }))

    await screen.findAllByRole('group')

    await waitFor(() => expect(document.title).toBe('Medium quiz on React | AI Tutor'))
  })
})
