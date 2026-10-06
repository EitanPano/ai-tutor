import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Conversation } from '@/component/thread/conversation'
import type { AskHandlers, AskResult } from '@/lib/api/ask'
import { ApiError } from '@/lib/api/error'
import type { Message, Thread } from '@/lib/api/thread'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({
  askQuestion: vi.fn(),
  getThread: vi.fn(),
  updateThread: vi.fn(),
  deleteThread: vi.fn(),
  listTopics: vi.fn()
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('@/lib/api/ask', () => ({ askQuestion: api.askQuestion }))
vi.mock('@/lib/api/topic', () => ({ listTopics: api.listTopics }))
vi.mock('@/lib/api/thread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/thread')>()),
  getThread: api.getThread,
  updateThread: api.updateThread,
  deleteThread: api.deleteThread
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const THREAD_ID = 't1'

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: THREAD_ID,
  topicId: 'react',
  title: 'Why does my effect run twice?',
  messageCount: 0,
  createdAt: '2026-10-06T10:00:00Z',
  updatedAt: '2026-10-06T10:00:00Z',
  ...over
})

const message = (over: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message => ({
  threadId: THREAD_ID,
  status: 'complete',
  stopReason: null,
  createdAt: '2026-10-06T10:00:00Z',
  ...over
})

function serve(t: Thread, messages: Message[]) {
  api.getThread.mockResolvedValue({ thread: t, messages, guides: [], quizzes: [] })
}

/** An `askQuestion` the test drives by hand; resolves once `finish` is called. */
function controlledAsk() {
  let handlers!: AskHandlers
  let finish!: (result: AskResult) => void
  api.askQuestion.mockImplementation(
    (_id: string, _question: string, h: AskHandlers) =>
      new Promise((resolve) => {
        handlers = h
        finish = resolve
        h.signal?.addEventListener('abort', () => resolve('stopped'))
      })
  )
  return {
    start: () =>
      act(() =>
        handlers.onStart?.({ threadId: THREAD_ID, userMessageId: 'u2', assistantMessageId: 'a2' })
      ),
    delta: (text: string) => act(() => handlers.onDelta?.(text)),
    complete: () =>
      act(async () => {
        handlers.onComplete?.({
          messageId: 'a2',
          status: 'complete',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }
        })
        finish('completed')
      }),
    signal: () => handlers.signal
  }
}

beforeEach(() => {
  api.listTopics.mockResolvedValue({
    topics: [
      { id: 'react', name: 'React' },
      { id: 'other', name: 'Other' }
    ]
  })
  serve(thread(), [])
})

afterEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

async function open() {
  renderWithQuery(<Conversation threadId={THREAD_ID} />)
  await screen.findByRole('button', { name: /Rename thread/ })
}

describe('Conversation', () => {
  it('goes from Thinking to streaming to complete for a parked question', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Why twice?')
    const ask = controlledAsk()
    renderWithQuery(<Conversation threadId={THREAD_ID} />)

    expect(await screen.findByText('Thinking…')).toBeInTheDocument()
    expect(api.askQuestion).toHaveBeenCalledWith(THREAD_ID, 'Why twice?', expect.any(Object))
    expect(sessionStorage.getItem(`pending-question:${THREAD_ID}`)).toBeNull()
    const [asked] = screen.getAllByRole('article', { name: 'Your question' })
    expect(asked).toHaveTextContent('Why twice?')
    const answer = screen.getByRole('article', { name: 'Tutor answer' })
    expect(answer).toHaveAttribute('aria-busy', 'true')

    await ask.start()
    await ask.delta('Strict Mode ')
    await ask.delta('mounts twice.')

    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Tutor answer' })).toHaveTextContent(
      'Strict Mode mounts twice.'
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    // The streaming text itself is not announced: the live region stays empty until the end.
    expect(screen.getAllByRole('status').every((el) => el.textContent === '')).toBe(true)

    serve(thread({ messageCount: 2 }), [
      message({ id: 'u2', role: 'user', content: 'Why twice?' }),
      message({
        id: 'a2',
        role: 'assistant',
        content: 'Strict Mode mounts twice.',
        stopReason: 'end_turn'
      })
    ])
    await ask.complete()

    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Tutor answer' })).not.toHaveAttribute('aria-busy')
    )
    expect(screen.getAllByRole('status').some((el) => el.textContent === 'Answer ready')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: 'Tutor answer' })).toHaveLength(1)
    expect(screen.getAllByRole('article', { name: 'Your question' })).toHaveLength(1)
  })

  it('aborts the request when Stop is pressed', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Why?')
    const ask = controlledAsk()
    renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await screen.findByText('Thinking…')
    await ask.start()
    await ask.delta('Partial')

    serve(thread({ messageCount: 2 }), [
      message({ id: 'u2', role: 'user', content: 'Why?' }),
      message({
        id: 'a2',
        role: 'assistant',
        content: 'Partial',
        status: 'incomplete',
        stopReason: 'aborted'
      })
    ])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }))

    expect(ask.signal()?.aborted).toBe(true)
    expect(await screen.findByText('Stopped before the answer finished.')).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows the cut-off note for an answer that hit the length limit', async () => {
    serve(thread({ messageCount: 2 }), [
      message({ id: 'u1', role: 'user', content: 'Explain closures' }),
      message({
        id: 'a1',
        role: 'assistant',
        content: 'A closure is',
        status: 'incomplete',
        stopReason: 'max_tokens'
      })
    ])
    await open()

    expect(
      screen.getByText('This answer was cut off at the length limit. Ask a follow-up to continue.')
    ).toBeInTheDocument()
  })

  it('dims a failed turn and re-asks the question with Retry', async () => {
    serve(thread({ messageCount: 0 }), [
      message({ id: 'u1', role: 'user', content: 'Explain closures', status: 'failed' }),
      message({
        id: 'a1',
        role: 'assistant',
        content: '',
        status: 'failed',
        stopReason: 'error'
      })
    ])
    api.askQuestion.mockResolvedValue('completed')
    await open()

    expect(screen.getByText('This answer failed.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))

    expect(api.askQuestion).toHaveBeenCalledWith(THREAD_ID, 'Explain closures', expect.any(Object))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled())
  })

  it('explains a refusal and offers Retry', async () => {
    serve(thread(), [
      message({ id: 'u1', role: 'user', content: 'bad', status: 'failed' }),
      message({ id: 'a1', role: 'assistant', content: '', status: 'failed', stopReason: 'refusal' })
    ])
    await open()

    expect(
      screen.getByText("The tutor can't help with that question. Try rephrasing it.")
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the budget banner, disables the composer and keeps the question', async () => {
    api.askQuestion.mockRejectedValue(
      new ApiError({ status: 429, code: 'ai_budget_exceeded', message: 'x' })
    )
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByLabelText('Your question'), 'Hello there')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))

    expect(
      await screen.findByText(
        "You've used today's AI budget. It resets at midnight in your time zone."
      )
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toBeDisabled()
    expect(screen.getByLabelText('Your question')).toHaveValue('Hello there')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('AI budget'), {})
  })

  it('offers a Retry action in the toast for a retryable failure', async () => {
    api.askQuestion.mockRejectedValue(
      new ApiError({ status: 0, code: 'ai_provider_error', message: 'x' })
    )
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByLabelText('Your question'), 'Hello')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const options = toast.error.mock.calls[0]?.[1] as { action?: { label: string } }
    expect(options.action?.label).toBe('Retry')
  })

  it('shows the full banner and disables the composer when the thread is at the limit', async () => {
    serve(thread({ messageCount: 24 }), [])
    await open()

    const banner = screen.getByText('This thread is full. Start a new thread to keep going.')
    const link = within(banner.parentElement as HTMLElement).getByRole('link', {
      name: 'New thread'
    })
    expect(link).toHaveAttribute('href', '/thread?topic=react')
    expect(screen.getByLabelText('Your question')).toBeDisabled()
  })

  it('stays open for questions one turn below the limit', async () => {
    serve(thread({ messageCount: 23 }), [])
    await open()

    expect(screen.queryByText(/This thread is full/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toBeEnabled()
  })

  it('shows a not-found message with a way back', async () => {
    api.getThread.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'x' }))
    renderWithQuery(<Conversation threadId={THREAD_ID} />)

    expect(await screen.findByText("This thread doesn't exist or was deleted.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
  })
})
