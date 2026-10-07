import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadHeader } from '@/component/thread/thread-header'
import type { Thread } from '@/lib/api/thread'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({
  updateThread: vi.fn(),
  deleteThread: vi.fn(),
  listTopics: vi.fn()
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('@/lib/api/topic', () => ({ listTopics: api.listTopics }))
vi.mock('@/lib/api/thread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/thread')>()),
  updateThread: api.updateThread,
  deleteThread: api.deleteThread
}))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const thread: Thread = {
  id: 't1',
  topicId: 'react',
  title: 'Closures',
  messageCount: 2,
  createdAt: '2026-10-06T10:00:00Z',
  updatedAt: '2026-10-06T10:00:00Z'
}

afterEach(() => {
  vi.clearAllMocks()
})

async function setup() {
  api.listTopics.mockResolvedValue({
    topics: [
      { id: 'react', name: 'React' },
      { id: 'sql', name: 'SQL' }
    ]
  })
  api.updateThread.mockResolvedValue({ thread })
  renderWithQuery(<ThreadHeader thread={thread} />)
  await waitFor(() => expect(screen.getByLabelText('Topic')).toBeEnabled())
  return userEvent.setup()
}

describe('ThreadHeader', () => {
  it('renames with Enter', async () => {
    const typist = await setup()

    await typist.click(screen.getByRole('button', { name: 'Rename thread: Closures' }))
    await typist.clear(screen.getByLabelText('Thread title'))
    await typist.type(screen.getByLabelText('Thread title'), 'Scope rules{Enter}')

    await waitFor(() =>
      expect(api.updateThread).toHaveBeenCalledWith('t1', { title: 'Scope rules' })
    )
    expect(screen.queryByLabelText('Thread title')).not.toBeInTheDocument()
  })

  it('cancels a rename with Escape', async () => {
    const typist = await setup()

    await typist.click(screen.getByRole('button', { name: 'Rename thread: Closures' }))
    await typist.type(screen.getByLabelText('Thread title'), ' extra{Escape}')

    expect(api.updateThread).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Rename thread: Closures' })).toBeInTheDocument()
  })

  it('changes the topic', async () => {
    const typist = await setup()

    await typist.selectOptions(screen.getByLabelText('Topic'), 'sql')

    await waitFor(() => expect(api.updateThread).toHaveBeenCalledWith('t1', { topicId: 'sql' }))
  })

  it('confirms inline before deleting, then returns to /thread', async () => {
    api.deleteThread.mockResolvedValue(undefined)
    const typist = await setup()

    await typist.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this thread?')).toBeInTheDocument()
    expect(api.deleteThread).not.toHaveBeenCalled()
    // Focus moves onto the safe choice, and the two actions have distinct names.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    await typist.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this thread?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()

    await typist.click(screen.getByRole('button', { name: 'Delete' }))
    await typist.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(api.deleteThread).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/thread'))
    expect(toast).toHaveBeenCalledWith('Thread deleted')
  })
})
