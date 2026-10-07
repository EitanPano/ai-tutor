import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttemptView } from '@/component/quiz/attempt-view'
import { ApiError } from '@/lib/api/error'
import type { Attempt, GradedItem } from '@/lib/api/quiz'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({
  getAttempt: vi.fn(),
  getQuiz: vi.fn(),
  listTopics: vi.fn()
}))

vi.mock('@/lib/api/quiz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/quiz')>()),
  getAttempt: api.getAttempt,
  getQuiz: api.getQuiz
}))
vi.mock('@/lib/api/topic', () => ({ listTopics: api.listTopics }))
// Highlighting is a nicety that loads Shiki: the plain block is enough here.
vi.mock('@/component/markdown/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>
}))

afterEach(() => {
  vi.clearAllMocks()
})

const item = (n: number, choiceIndex: number, answerIndex: number): GradedItem => ({
  itemId: `i${n}`,
  position: n,
  prompt: `Prompt ${n} with \`code${n}\``,
  choices: [0, 1, 2, 3].map((c) => `Choice ${n}.${c}`),
  choiceIndex,
  answerIndex,
  correct: choiceIndex === answerIndex,
  explanation: `Because **reason ${n}**.`
})

// Items 1 and 3 are right; items 2, 4 and 5 are wrong.
const attempt = (): Attempt => ({
  id: 'a1',
  quizId: 'q1',
  score: 2,
  total: 5,
  submittedAt: '2026-10-06T12:00:00Z',
  items: [item(1, 3, 3), item(2, 0, 2), item(3, 1, 1), item(4, 3, 0), item(5, 2, 3)]
})

function setup({ threadId = 't1' as string | null } = {}) {
  api.getAttempt.mockResolvedValue({ attempt: attempt() })
  api.getQuiz.mockResolvedValue({
    quiz: {
      id: 'q1',
      threadId,
      topicId: 'react',
      difficulty: 'hard',
      createdAt: '',
      items: [],
      attempts: []
    }
  })
  api.listTopics.mockResolvedValue({ topics: [{ id: 'react', name: 'React' }] })
  renderWithQuery(<AttemptView quizId="q1" attemptId="a1" />)
}

describe('AttemptView', () => {
  it('leads with the score and names the quiz', async () => {
    setup()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('2 of 5 correct')
    expect(heading).toHaveFocus()
    expect(await screen.findByText('Hard quiz on React')).toBeVisible()
  })

  it('shows every item in order with its explanation', async () => {
    setup()
    await screen.findByRole('heading', { level: 1 })

    const explanations = screen.getAllByText(/^reason \d$/)
    expect(explanations.map((e) => e.textContent)).toEqual([
      'reason 1',
      'reason 2',
      'reason 3',
      'reason 4',
      'reason 5'
    ])
    expect(screen.getAllByText('Explanation')).toHaveLength(5)
    expect(screen.getByText('code1').tagName).toBe('CODE')
  })

  it('says Correct or Incorrect for each item, in words', async () => {
    setup()
    await screen.findByRole('heading', { level: 1 })

    const verdicts = screen.getAllByText(/^(Correct|Incorrect)$/).map((e) => e.textContent)
    expect(verdicts).toEqual(['Correct', 'Incorrect', 'Correct', 'Incorrect', 'Incorrect'])
  })

  it('marks the right choice, and a wrong pick as struck through, with text and not colour alone', async () => {
    setup()
    await screen.findByRole('heading', { level: 1 })

    const lists = screen.getAllByRole('list', { name: 'Choices' })
    // Item 2: picked choice 0, the answer is choice 2.
    const second = within(lists[1]!).getAllByRole('listitem')
    expect(within(second[0]!).getByText('Your answer')).toBeVisible()
    expect(within(second[0]!).getByText('Choice 2.0')).toHaveClass('line-through')
    expect(within(second[0]!).queryByText('Correct answer')).toBeNull()
    expect(within(second[2]!).getByText('Correct answer')).toBeVisible()
    expect(within(second[2]!).getByText('Choice 2.2')).not.toHaveClass('line-through')
    expect(within(second[1]!).queryByText(/answer/)).toBeNull()
    expect(within(second[3]!).queryByText(/answer/)).toBeNull()

    // Item 1: picked the answer, which carries both labels and no strike.
    const first = within(lists[0]!).getAllByRole('listitem')
    expect(within(first[3]!).getByText('Your answer')).toBeVisible()
    expect(within(first[3]!).getByText('Correct answer')).toBeVisible()
    expect(within(first[3]!).getByText('Choice 1.3')).not.toHaveClass('line-through')
  })

  it('offers Retake quiz and a way back to the conversation', async () => {
    setup()

    expect(await screen.findByRole('link', { name: 'Retake quiz' })).toHaveAttribute(
      'href',
      '/quiz/q1'
    )
    expect(await screen.findByRole('link', { name: 'Back to the conversation' })).toHaveAttribute(
      'href',
      '/thread/t1'
    )
  })

  it('has no conversation to go back to for a topic quiz', async () => {
    setup({ threadId: null })

    await screen.findByRole('link', { name: 'Retake quiz' })
    expect(await screen.findByText('Hard quiz on React')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Back to the conversation' })).toBeNull()
  })

  it('says so when the attempt does not exist', async () => {
    api.getAttempt.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'x' }))
    api.getQuiz.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'x' }))
    api.listTopics.mockResolvedValue({ topics: [] })
    renderWithQuery(<AttemptView quizId="q1" attemptId="gone" />)

    expect(await screen.findByText("This quiz doesn't exist or was deleted.")).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to threads' })).toBeVisible()
  })
})
