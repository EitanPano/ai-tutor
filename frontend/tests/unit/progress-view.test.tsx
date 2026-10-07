import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressView } from '@/component/progress/progress-view'
import { ApiError } from '@/lib/api/error'
import type { ProgressResponse, TopicProgress } from '@/lib/api/progress'

const api = vi.hoisted(() => ({
  getProgress: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  createQuiz: vi.fn()
}))
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
)
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('@/lib/api/progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/progress')>()),
  getProgress: api.getProgress
}))
vi.mock('@/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/session')>()),
  getSession: api.getSession
}))
vi.mock('@/lib/api/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/user')>()),
  updateUser: api.updateUser
}))
vi.mock('@/lib/api/quiz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/quiz')>()),
  createQuiz: api.createQuiz
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const user = {
  id: 'u1',
  email: 'a@example.com',
  displayName: 'Ada',
  timeZone: 'Europe/Paris',
  createdAt: '2026-09-01T10:00:00Z'
}

const topic = (id: string, name: string, over: Partial<TopicProgress> = {}): TopicProgress => ({
  topicId: id,
  topicName: name,
  questions: 0,
  guidesCompleted: 0,
  stepsDone: 0,
  attempts: 0,
  bestScorePercent: null,
  averageScorePercent: null,
  lastActivityAt: null,
  ...over
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const progress = (over: Partial<ProgressResponse> = {}): ProgressResponse => ({
  totals: { questions: 3, guidesCompleted: 1, stepsDone: 4, attempts: 1 },
  streak: { current: 3, longest: 5, activeToday: true },
  topics: [
    topic('js', 'JavaScript'),
    topic('react', 'React', {
      questions: 2,
      stepsDone: 4,
      attempts: 1,
      bestScorePercent: 80,
      averageScorePercent: 66.7,
      lastActivityAt: hoursAgo(5)
    }),
    topic('sql', 'SQL', { questions: 1, lastActivityAt: hoursAgo(1) }),
    topic('css', 'CSS')
  ],
  recent: [
    {
      kind: 'question',
      at: hoursAgo(1),
      topicId: 'sql',
      title: 'Why is my join slow?',
      threadId: 't1',
      guideId: null,
      quizId: null
    },
    {
      kind: 'step',
      at: hoursAgo(2),
      topicId: 'react',
      title: 'Lift state up',
      threadId: null,
      guideId: 'g1',
      quizId: null
    },
    {
      kind: 'attempt',
      at: hoursAgo(3),
      topicId: 'react',
      title: 'Hooks quiz',
      threadId: null,
      guideId: null,
      quizId: 'q1'
    }
  ],
  ...over
})

function setup(data: ProgressResponse = progress(), sessionUser = user) {
  api.getProgress.mockResolvedValue(data)
  api.getSession.mockResolvedValue({ user: sessionUser })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <ProgressView />
    </QueryClientProvider>
  )
  return { typist: userEvent.setup(), invalidate }
}

beforeEach(() => {
  vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([
    'Asia/Tokyo',
    'Europe/Paris',
    'America/New_York'
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('streak', () => {
  it('celebrates a streak that is active today', async () => {
    setup()

    const streak = await screen.findByRole('region', { name: 'Streak' })
    expect(streak).toHaveTextContent('3 day streak')
    expect(within(streak).getByText('3')).toHaveClass('marker')
    expect(within(streak).getByText('Longest: 5 days')).toBeVisible()
    expect(within(streak).getByText('You studied today.')).toBeVisible()
  })

  it('nudges when the streak is alive but today is still empty', async () => {
    setup(progress({ streak: { current: 1, longest: 1, activeToday: false } }))

    const streak = await screen.findByRole('region', { name: 'Streak' })
    expect(streak).toHaveTextContent('1 day streak')
    expect(within(streak).getByText('Longest: 1 day')).toBeVisible()
    expect(
      within(streak).getByText(
        'Ask a question, finish a step or take a quiz today to keep it going.'
      )
    ).toBeVisible()
  })

  it('invites a first question when there is no streak', async () => {
    setup(progress({ streak: { current: 0, longest: 0, activeToday: false } }))

    const streak = await screen.findByRole('region', { name: 'Streak' })
    expect(within(streak).getByText('No streak yet. Ask a question to start one.')).toBeVisible()
    expect(streak).not.toHaveTextContent('day streak')
    expect(streak).not.toHaveTextContent('Longest')
  })

  it('sums the totals in one line', async () => {
    setup()

    expect(
      await screen.findByText('3 questions asked, 4 steps done, 1 guide completed, 1 quiz attempt')
    ).toBeVisible()
  })
})

describe('topic table', () => {
  const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}\\b`) })

  it('lists active topics newest first, then the ones not started, under a sub-heading', async () => {
    setup()

    await screen.findByRole('table')
    const names = screen.getAllByRole('rowheader').map((h) => h.textContent)

    expect(names).toEqual(['SQL', 'React', 'JavaScript', 'CSS'])
    const group = screen.getByRole('rowgroup', { name: 'Not started yet' })
    expect(
      within(group)
        .getAllByRole('rowheader')
        .map((h) => h.textContent)
    ).toEqual(['JavaScript', 'CSS'])
    expect(rowOf('JavaScript')).toHaveClass('text-ink-muted')
    expect(rowOf('React')).not.toHaveClass('text-ink-muted')
  })

  it('keeps explicit table roles and a label inside each cell, so the stacked layout stays a table', async () => {
    setup()

    const table = await screen.findByRole('table', { name: 'Topics' })
    expect(table).toHaveAttribute('role', 'table')
    for (const el of table.querySelectorAll('thead, tbody'))
      expect(el).toHaveAttribute('role', 'rowgroup')
    for (const el of table.querySelectorAll('tr')) expect(el).toHaveAttribute('role', 'row')
    for (const el of table.querySelectorAll('th')) {
      expect(['columnheader', 'rowheader']).toContain(el.getAttribute('role'))
    }
    for (const el of table.querySelectorAll('td')) expect(el).toHaveAttribute('role', 'cell')
    const react = within(rowOf('React'))
    expect(react.getAllByRole('cell')[0]).toHaveTextContent('Questions2')
    expect(react.getByRole('cell', { name: /Best score\s*80%/ })).toBeVisible()
  })

  it('has a labelled column for every measure', async () => {
    setup()

    await screen.findByRole('table')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Topic',
      'Questions',
      'Steps done',
      'Guides completed',
      'Quiz attempts',
      'Best score',
      'Topic score',
      'Last activity',
      'Quiz'
    ])
    expect(screen.getByRole('columnheader', { name: 'Topic score' })).toHaveAttribute(
      'title',
      "Average of each quiz's best attempt"
    )
  })

  it('shows scores as whole percentages and a missing score as a dash named "no score yet"', async () => {
    setup()

    await screen.findByRole('table')
    const react = within(rowOf('React'))
    expect(react.getByText('80%')).toBeVisible()
    expect(react.getByText('67%')).toBeVisible()
    const sql = within(rowOf('SQL'))
    expect(sql.getAllByRole('img', { name: 'no score yet' })).toHaveLength(2)
  })

  it('asks for a quiz on the topic with the chosen difficulty and opens it', async () => {
    api.createQuiz.mockResolvedValue({
      quiz: {
        id: 'q9',
        threadId: null,
        topicId: 'css',
        difficulty: 'hard',
        createdAt: '',
        items: [],
        attempts: []
      }
    })
    const { typist } = setup()

    await screen.findByRole('table')
    await typist.selectOptions(screen.getByLabelText('Difficulty for the CSS quiz'), 'Hard')
    await typist.click(screen.getByRole('button', { name: 'Quiz me on CSS' }))

    await waitFor(() =>
      expect(api.createQuiz).toHaveBeenCalledWith({ topicId: 'css', difficulty: 'hard' })
    )
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q9'))
  })

  it('defaults to a medium quiz and toasts a failure', async () => {
    api.createQuiz.mockRejectedValue(
      new ApiError({ status: 422, code: 'ai_refused', message: 'x' })
    )
    const { typist } = setup()

    await screen.findByRole('table')
    await typist.click(screen.getByRole('button', { name: 'Quiz me on React' }))

    await waitFor(() =>
      expect(api.createQuiz).toHaveBeenCalledWith({ topicId: 'react', difficulty: 'medium' })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('recent activity', () => {
  it('links each entry to its thread, guide or quiz', async () => {
    setup()

    const links = await screen.findAllByRole('link', {
      name: /Question:|Guide step:|Quiz attempt:/
    })
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/thread/t1',
      '/guide/g1',
      '/quiz/q1'
    ])
    expect(links[0]).toHaveAccessibleName(/Question: Why is my join slow\? SQL 1h ago/)
    expect(links[2]).toHaveTextContent('React')
  })

  it('asks for a first question when there is nothing yet', async () => {
    setup(progress({ recent: [] }))

    expect(await screen.findByText('Nothing here yet. Ask your first question.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ask a question' })).toHaveAttribute('href', '/thread')
  })
})

describe('profile', () => {
  const nameField = () => screen.findByLabelText('Display name')

  it('shows the saved values, the member-since date, and waits for a change', async () => {
    setup()

    expect(await nameField()).toHaveValue('Ada')
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Paris')
    expect(screen.getByText(/^Member since .*2026/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save profile' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('keeps a stored time zone the browser does not list', async () => {
    setup(progress(), { ...user, timeZone: 'UTC' })

    expect(await screen.findByRole('option', { name: 'UTC' })).toBeInTheDocument()
  })

  it('selects a normalised zone the browser lists only under its legacy spelling, and round-trips a legacy pick', async () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Calcutta', 'Europe/Paris'])
    api.updateUser.mockResolvedValue({ user: { ...user, timeZone: 'Asia/Kolkata' } })
    const { typist } = setup(progress(), { ...user, timeZone: 'Asia/Kolkata' })

    const select = await screen.findByLabelText('Time zone')
    expect(select).toHaveValue('Asia/Kolkata')

    await typist.selectOptions(select, 'Europe/Paris')
    await typist.selectOptions(select, 'Asia/Calcutta')
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith({ timeZone: 'Asia/Calcutta' }))
    await waitFor(() => expect(screen.getByLabelText('Time zone')).toHaveValue('Asia/Kolkata'))
    expect(screen.queryByText(/something went wrong|failed/i)).not.toBeInTheDocument()
  })

  it('sends only the changed field, then refreshes the session and progress', async () => {
    const saved = { ...user, displayName: 'Grace' }
    api.updateUser.mockResolvedValue({ user: saved })
    const { typist, invalidate } = setup()

    const name = await nameField()
    // The refetch after the save sees the server's new name.
    api.getSession.mockResolvedValue({ user: saved })
    await typist.clear(name)
    await typist.type(name, 'Grace')
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith({ displayName: 'Grace' }))
    expect(toast.success).toHaveBeenCalledWith('Profile saved')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['session'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['progress'] })
    expect(screen.getByRole('button', { name: 'Save profile' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('keeps keyboard focus on Save profile after saving', async () => {
    const saved = { ...user, displayName: 'Grace' }
    api.updateUser.mockResolvedValue({ user: saved })
    const { typist } = setup()

    const name = await nameField()
    api.getSession.mockResolvedValue({ user: saved })
    await typist.clear(name)
    await typist.type(name, 'Grace')
    const button = screen.getByRole('button', { name: 'Save profile' })
    button.focus()
    await typist.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'))
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
  })

  it('does not save when the button is only aria-disabled', async () => {
    const { typist } = setup()

    await nameField()
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(api.updateUser).not.toHaveBeenCalled()
  })

  it('links a time zone error to the select', async () => {
    api.updateUser.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'validation_failed',
        message: 'x',
        details: { issues: [{ path: ['timeZone'], message: 'Unknown time zone' }] }
      })
    )
    const { typist } = setup()

    await nameField()
    await typist.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Tokyo')
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    const select = screen.getByLabelText('Time zone')
    await waitFor(() => expect(select).toHaveAccessibleDescription(/Unknown time zone/))
    expect(select).toHaveAccessibleDescription(/Your streak counts days/)
    expect(select).toBeInvalid()
  })

  it('sends a changed time zone alone', async () => {
    api.updateUser.mockResolvedValue({ user: { ...user, timeZone: 'Asia/Tokyo' } })
    const { typist } = setup()

    await nameField()
    await typist.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Tokyo')
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith({ timeZone: 'Asia/Tokyo' }))
  })

  it('shows field errors inline and keeps the edit', async () => {
    api.updateUser.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'validation_failed',
        message: 'x',
        details: { issues: [{ path: ['displayName'], message: 'Display name is required' }] }
      })
    )
    const { typist } = setup()

    const name = await nameField()
    await typist.clear(name)
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Display name is required')).toBeVisible()
    expect(name).toHaveAccessibleDescription('Display name is required')
    expect(name).toHaveValue('')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says so when the save fails for any other reason', async () => {
    api.updateUser.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'x' }))
    const { typist } = setup()

    await nameField()
    await typist.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Tokyo')
    await typist.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server hit a problem. Try again in a moment.'
    )
  })
})

describe('loading and failure', () => {
  it('shows a skeleton while loading', () => {
    api.getProgress.mockReturnValue(new Promise(() => {}))
    api.getSession.mockResolvedValue({ user })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <ProgressView />
      </QueryClientProvider>
    )

    expect(screen.getByLabelText('Loading progress')).toBeInTheDocument()
  })

  it('toasts a failure and offers Retry inline', async () => {
    api.getProgress.mockRejectedValueOnce(
      new ApiError({ status: 500, code: 'internal', message: 'x' })
    )
    // The first load fails; setup's default answers the retry.
    const { typist } = setup()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    await typist.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
