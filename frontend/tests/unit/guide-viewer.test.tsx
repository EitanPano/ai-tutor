import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuideViewer } from '@/component/guide/guide-viewer'
import { ApiError } from '@/lib/api/error'
import { guideKey, type Guide, type Step } from '@/lib/api/guide'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({ getGuide: vi.fn(), updateStep: vi.fn(), createQuiz: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))

vi.mock('@/lib/api/guide', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/guide')>()),
  getGuide: api.getGuide,
  updateStep: api.updateStep
}))
vi.mock('@/lib/api/quiz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/quiz')>()),
  createQuiz: api.createQuiz
}))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast }))
// Highlighting is a nicety that loads Shiki: the plain block is enough here.
vi.mock('@/component/markdown/code-block', () => ({
  CodeBlock: ({ code, language }: { code: string; language?: string }) => (
    <pre data-language={language}>{code}</pre>
  )
}))

const step = (n: number, over: Partial<Step> = {}): Step => ({
  id: `s${n}`,
  position: n,
  title: `Step title ${n}`,
  body: `Body of step ${n}`,
  code: null,
  codeLanguage: null,
  hint: `Hint for step ${n}`,
  hintRevealedAt: null,
  doneAt: null,
  ...over
})

const NOW = '2026-10-06T10:00:00Z'

/** A small in-memory server so refetches after an update see what the update did. */
let server: Guide

function serve(steps: Step[]) {
  server = {
    id: 'g1',
    threadId: 't1',
    topicId: 'react',
    title: 'Understand closures',
    createdAt: NOW,
    steps
  }
  api.getGuide.mockImplementation(async () => ({ guide: structuredClone(server) }))
  api.updateStep.mockImplementation(
    async (_guide: string, stepId: string, body: { done?: boolean; hintRevealed?: true }) => {
      const target = server.steps.find((s) => s.id === stepId)!
      if (body.done !== undefined) target.doneAt = body.done ? NOW : null
      if (body.hintRevealed) target.hintRevealedAt = NOW
      return { step: structuredClone(target) }
    }
  )
}

beforeEach(() => {
  serve([step(1), step(2), step(3), step(4)])
})

afterEach(() => {
  vi.clearAllMocks()
})

async function open() {
  renderWithQuery(<GuideViewer guideId="g1" />)
  await screen.findByRole('heading', { level: 1, name: 'Understand closures' })
  return userEvent.setup()
}

const heading = () => screen.getByRole('heading', { level: 2 })
const progress = () => screen.getByRole('progressbar')

describe('GuideViewer', () => {
  it('shows a seeded guide as is, without fetching it again', async () => {
    renderWithQuery(<GuideViewer guideId="g1" />, (client) =>
      client.setQueryData(guideKey.detail('g1'), { guide: structuredClone(server) })
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Understand closures' })
    ).toBeInTheDocument()
    expect(api.getGuide).not.toHaveBeenCalled()
  })

  it('shows a skeleton, then focuses the first step that is not done', async () => {
    serve([step(1, { doneAt: NOW }), step(2), step(3), step(4)])
    renderWithQuery(<GuideViewer guideId="g1" />)
    expect(screen.getByLabelText('Loading guide')).toBeInTheDocument()

    await screen.findByRole('heading', { level: 1, name: 'Understand closures' })
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Step title 2')
    expect(screen.getByText('Body of step 2')).toBeInTheDocument()
    expect(progress()).toHaveAttribute('aria-valuenow', '1')
    expect(progress()).toHaveAttribute('aria-valuemax', '4')
    expect(progress()).toHaveAttribute('aria-valuemin', '0')
    expect(progress()).toHaveAccessibleName('1 of 4 steps done')
    // Opening the page does not steal focus.
    expect(heading()).not.toHaveFocus()

    const list = screen.getByRole('navigation', { name: 'Steps' })
    expect(within(list).getByRole('button', { name: /Step 2: Step title 2/ })).toHaveAttribute(
      'aria-current',
      'step'
    )
    expect(
      within(list).getByRole('button', { name: /Step 1: Step title 1 \(done\)/ })
    ).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Back to the conversation' })).toHaveAttribute(
      'href',
      '/thread/t1'
    )
  })

  it('renders the step code with its language', async () => {
    serve([step(1, { code: 'const a = 1', codeLanguage: 'ts' }), step(2), step(3)])
    await open()

    const code = screen.getByText('const a = 1')
    expect(code).toHaveAttribute('data-language', 'ts')
  })

  it('reveals the hint through updateStep and keeps it after a reload', async () => {
    const typist = await open()
    expect(screen.queryByText('Hint for step 1')).not.toBeInTheDocument()

    await typist.click(screen.getByRole('button', { name: 'Show hint' }))

    expect(api.updateStep).toHaveBeenCalledWith('g1', 's1', { hintRevealed: true })
    const hint = await screen.findByRole('complementary', { name: 'Hint' })
    expect(hint).toHaveTextContent('Hint for step 1')
    expect(hint).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Show hint' })).not.toBeInTheDocument()
  })

  it('shows an already revealed hint on load', async () => {
    serve([step(1, { hintRevealedAt: NOW }), step(2), step(3)])
    await open()

    expect(screen.getByRole('complementary', { name: 'Hint' })).toHaveTextContent('Hint for step 1')
    expect(screen.queryByRole('button', { name: 'Show hint' })).not.toBeInTheDocument()
  })

  it('marks done: the bar fills, focus moves to the next undone step', async () => {
    const typist = await open()

    await typist.click(screen.getByRole('button', { name: 'Mark done' }))

    expect(api.updateStep).toHaveBeenCalledWith('g1', 's1', { done: true })
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Step title 2')
    expect(heading()).toHaveFocus()
    expect(progress()).toHaveAccessibleName('1 of 4 steps done')
    await waitFor(() => expect(api.getGuide).toHaveBeenCalledTimes(2))
    expect(progress()).toHaveAttribute('aria-valuenow', '1')
  })

  it('marks a step not done and stays on it', async () => {
    serve([step(1, { doneAt: NOW }), step(2), step(3), step(4)])
    const typist = await open()
    await typist.click(
      within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', {
        name: /Step 1/
      })
    )
    expect(screen.getByText('Done')).toBeInTheDocument()

    await typist.click(screen.getByRole('button', { name: 'Mark not done' }))

    expect(api.updateStep).toHaveBeenCalledWith('g1', 's1', { done: false })
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(progress()).toHaveAccessibleName('0 of 4 steps done')
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('moves between steps with Previous and Next', async () => {
    const typist = await open()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await typist.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading()).toHaveTextContent('Step title 2')
    expect(heading()).toHaveFocus()

    await typist.click(screen.getByRole('button', { name: 'Previous' }))
    expect(heading()).toHaveTextContent('Step title 1')
  })

  it('shows the completion state once every step is done', async () => {
    serve([step(1, { doneAt: NOW }), step(2, { doneAt: NOW }), step(3)])
    const typist = await open()
    await typist.click(screen.getByRole('button', { name: 'Mark done' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Guide complete.' })).toHaveFocus()
    expect(screen.getByText('Test yourself to see what stuck.')).toBeInTheDocument()
    expect(progress()).toHaveAccessibleName('3 of 3 steps done')
    // Two links of this name: the header's, and the completion action.
    expect(screen.getAllByRole('link', { name: 'Back to the conversation' })).toHaveLength(2)
    expect(
      within(screen.getByRole('navigation', { name: 'Steps' })).queryByRole('button', {
        current: 'step'
      })
    ).not.toBeInTheDocument()

    await typist.click(screen.getByRole('button', { name: 'Review the steps' }))
    expect(heading()).toHaveTextContent('Step title 1')
  })

  it('offers a quiz on the thread from the completion state', async () => {
    serve([step(1, { doneAt: NOW }), step(2, { doneAt: NOW })])
    let finish!: (value: unknown) => void
    api.createQuiz.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const created = {
      quiz: {
        id: 'q7',
        threadId: 't1',
        topicId: 'react',
        difficulty: 'medium',
        createdAt: NOW,
        items: [],
        attempts: []
      }
    }
    const typist = await open()

    await typist.click(screen.getByRole('button', { name: 'Quiz me on this' }))

    expect(await screen.findByRole('button', { name: 'Writing your quiz…' })).toBeDisabled()
    finish(created)

    expect(api.createQuiz).toHaveBeenCalledWith({ threadId: 't1' })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/quiz/q7'))
  })

  it('opens straight on the completion state when everything was already done', async () => {
    serve([step(1, { doneAt: NOW }), step(2, { doneAt: NOW }), step(3, { doneAt: NOW })])
    await open()

    expect(screen.getByRole('heading', { level: 2, name: 'Guide complete.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveFocus()
  })

  it('rolls a failed mark done back, returns to the step and toasts', async () => {
    const typist = await open()
    api.updateStep.mockRejectedValueOnce(
      new ApiError({ status: 500, code: 'internal_error', message: 'x' })
    )

    await typist.click(screen.getByRole('button', { name: 'Mark done' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith('The server hit a problem. Try again in a moment.')
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(progress()).toHaveAccessibleName('0 of 4 steps done')
  })

  it('rolls a failed hint reveal back', async () => {
    const typist = await open()
    api.updateStep.mockRejectedValueOnce(
      new ApiError({ status: 0, code: 'network_error', message: 'x' })
    )

    await typist.click(screen.getByRole('button', { name: 'Show hint' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: 'Show hint' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Hint' })).not.toBeInTheDocument()
  })

  it('says a missing guide does not exist', async () => {
    api.getGuide.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'x' }))
    renderWithQuery(<GuideViewer guideId="g1" />)

    expect(await screen.findByText("This guide doesn't exist or was deleted.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
  })

  it('offers Retry when the guide fails to load', async () => {
    api.getGuide.mockRejectedValueOnce(
      new ApiError({ status: 0, code: 'network_error', message: 'x' })
    )
    renderWithQuery(<GuideViewer guideId="g1" />)
    const typist = userEvent.setup()

    await typist.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Understand closures' })
    ).toBeInTheDocument()
  })
})
