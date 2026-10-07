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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }))
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
  vi.restoreAllMocks()
  vi.clearAllMocks()
  sessionStorage.clear()
})

/** Moves the clock past the grace period in which Stop ignores a click right after Ask. */
function pastStopGrace() {
  const realNow = Date.now.bind(Date)
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 1000)
}

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
    pastStopGrace()

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

  it('keeps the answer running when Ask is double-clicked', async () => {
    const ask = controlledAsk()
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'Why?')
    await typist.dblClick(screen.getByRole('button', { name: 'Ask' }))

    expect(api.askQuestion).toHaveBeenCalledTimes(1)
    expect(ask.signal()?.aborted).toBe(false)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('gives the question back to the composer when it is stopped before the server took it', async () => {
    const ask = controlledAsk()
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'Why?')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))
    pastStopGrace()
    await typist.click(screen.getByRole('button', { name: 'Stop' }))

    expect(ask.signal()?.aborted).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Why?')
    )
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

    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'Hello there')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))

    expect(
      await screen.findByText(
        "You've used today's AI budget. It resets at midnight in your time zone."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Hello there')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('AI budget'), {})
  })

  it('offers a Retry action in the toast for a retryable failure', async () => {
    api.askQuestion.mockRejectedValue(
      new ApiError({ status: 0, code: 'ai_provider_error', message: 'x' })
    )
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'Hello')
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
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled()
  })

  it('stays open for questions one turn below the limit', async () => {
    serve(thread({ messageCount: 23 }), [])
    await open()

    expect(screen.queryByText(/This thread is full/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeEnabled()
  })

  it('shows a not-found message with a way back', async () => {
    api.getThread.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'x' }))
    renderWithQuery(<Conversation threadId={THREAD_ID} />)

    expect(await screen.findByText("This thread doesn't exist or was deleted.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
  })

  it('keeps a streamed code block mounted while typing and while more text arrives', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Show code')
    const ask = controlledAsk()
    renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await screen.findByText('Thinking…')
    await ask.start()
    await ask.delta('Intro\n\n```ts\nconst a = 1\n```\n\n')

    const block = screen.getByRole('figure')
    const copy = within(block).getByRole('button', { name: 'Copy' })
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Your question' }), 'next one')
    await ask.delta('More text after the block')

    expect(screen.getByRole('figure')).toBe(block)
    expect(within(block).getByRole('button', { name: 'Copy' })).toBe(copy)
    expect(screen.getByText('More text after the block')).toBeInTheDocument()
  })

  it('blocks a second submit while an answer is in flight', async () => {
    controlledAsk()
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'first')
    await typist.keyboard('{Control>}{Enter}{/Control}')
    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'second')
    await typist.keyboard('{Control>}{Enter}{/Control}')

    expect(api.askQuestion).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
  })

  it('aborts the request on unmount without state warnings', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Why?')
    const ask = controlledAsk()
    const view = renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await screen.findByText('Thinking…')
    await ask.start()

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await act(async () => {
      view.unmount()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(ask.signal()?.aborted).toBe(true)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('re-polls after Stop until the server has saved the partial answer', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Why?')
    const ask = controlledAsk()
    const asked = message({ id: 'u2', role: 'user', content: 'Why?' })
    const placeholder = message({
      id: 'a2',
      role: 'assistant',
      content: '',
      status: 'incomplete',
      stopReason: null
    })
    const saved = message({
      id: 'a2',
      role: 'assistant',
      content: 'Partial',
      status: 'incomplete',
      stopReason: 'aborted'
    })
    renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await screen.findByText('Thinking…')
    await ask.start()
    await ask.delta('Partial')

    pastStopGrace()
    serve(thread({ messageCount: 2 }), [asked, placeholder])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }))
    // The first look after Stop still finds the empty placeholder; a later one finds the answer.
    await waitFor(() => expect(api.getThread.mock.calls.length).toBeGreaterThan(2))
    serve(thread({ messageCount: 2 }), [asked, saved])

    expect(await screen.findByText('Stopped before the answer finished.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeEnabled()
  })

  it('shows a failed turn even when the first load of the thread answers after the failure', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Why?')
    // The first load read the thread before the question was saved, and is the last to answer.
    let firstLoad!: () => void
    api.getThread.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          firstLoad = () => resolve({ thread: thread(), messages: [], guides: [], quizzes: [] })
        })
    )
    let handlers!: AskHandlers
    let fail!: (err: unknown) => void
    api.askQuestion.mockImplementation(
      (_id: string, _question: string, h: AskHandlers) =>
        new Promise((_resolve, reject) => {
          handlers = h
          fail = reject
        })
    )
    serve(thread({ messageCount: 0 }), [
      message({ id: 'u2', role: 'user', content: 'Why?', status: 'failed' }),
      message({ id: 'a2', role: 'assistant', content: '', status: 'failed', stopReason: 'error' })
    ])
    renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await waitFor(() => expect(api.askQuestion).toHaveBeenCalled())

    act(() =>
      handlers.onStart?.({ threadId: THREAD_ID, userMessageId: 'u2', assistantMessageId: 'a2' })
    )
    await act(async () =>
      fail(new ApiError({ status: 0, code: 'ai_provider_error', message: 'x' }))
    )
    await act(async () => firstLoad())

    expect(await screen.findByText('This answer failed.')).toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: 'Your question' })).toHaveLength(1)
  })

  it('shows the full banner when the server answers thread_full', async () => {
    api.askQuestion.mockRejectedValue(
      new ApiError({ status: 409, code: 'thread_full', message: 'x' })
    )
    await open()
    const typist = userEvent.setup()

    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'One more')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))

    expect(
      await screen.findByText('This thread is full. Start a new thread to keep going.')
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled()
    expect(toast.error).toHaveBeenCalledWith(
      'This thread is full. Start a new thread to keep going.',
      {}
    )
  })

  it('refreshes the thread when the stream starts and does not poll while streaming', async () => {
    sessionStorage.setItem(`pending-question:${THREAD_ID}`, 'Why?')
    const ask = controlledAsk()
    renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await screen.findByText('Thinking…')
    const before = api.getThread.mock.calls.length

    serve(thread({ title: 'Why?', messageCount: 2 }), [
      message({ id: 'u2', role: 'user', content: 'Why?' }),
      message({ id: 'a2', role: 'assistant', content: '', status: 'incomplete', stopReason: null })
    ])
    await ask.start()

    expect(await screen.findByRole('button', { name: 'Rename thread: Why?' })).toBeInTheDocument()
    const after = api.getThread.mock.calls.length
    expect(after).toBeGreaterThan(before)
    // The placeholder would normally be polled every 1.5 s; this page's own stream suppresses it.
    await new Promise((resolve) => setTimeout(resolve, 1700))
    expect(api.getThread.mock.calls.length).toBe(after)
  })

  it('gives up on an answer that never finishes and offers Retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      serve(thread({ messageCount: 2 }), [
        message({ id: 'u1', role: 'user', content: 'Explain closures' }),
        message({
          id: 'a1',
          role: 'assistant',
          content: '',
          status: 'incomplete',
          stopReason: null
        })
      ])
      await open()
      expect(screen.getByText('Thinking…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

      await act(() => vi.advanceTimersByTimeAsync(61_000))

      expect(screen.getByText('This answer failed.')).toBeInTheDocument()
      expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the draft once a toast Retry is accepted, so it cannot be sent twice', async () => {
    api.askQuestion.mockRejectedValueOnce(
      new ApiError({ status: 0, code: 'ai_provider_error', message: 'x' })
    )
    await open()
    const typist = userEvent.setup()
    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'Hello')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Hello')

    const retryAsk = controlledAsk()
    const options = toast.error.mock.calls[0]?.[1] as { action: { onClick: () => void } }
    act(() => options.action.onClick())
    await waitFor(() => expect(api.askQuestion).toHaveBeenCalledTimes(2))
    await retryAsk.start()

    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('')
  })

  it('dismisses error toasts and ignores their Retry after leaving the page', async () => {
    toast.error.mockReturnValue('toast-1')
    api.askQuestion.mockRejectedValue(
      new ApiError({ status: 0, code: 'ai_provider_error', message: 'x' })
    )
    const view = renderWithQuery(<Conversation threadId={THREAD_ID} />)
    await screen.findByRole('button', { name: /Rename thread/ })
    const typist = userEvent.setup()
    await typist.type(screen.getByRole('textbox', { name: 'Your question' }), 'Hello')
    await typist.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const options = toast.error.mock.calls[0]?.[1] as { action: { onClick: () => void } }

    view.unmount()
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('toast-1'))
    options.action.onClick()

    expect(api.askQuestion).toHaveBeenCalledTimes(1)
  })
})
