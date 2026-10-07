import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadList } from '@/component/thread/thread-list'
import { ApiError } from '@/lib/api/error'
import type { Thread } from '@/lib/api/thread'
import { renderWithQuery } from './test-utils'

const api = vi.hoisted(() => ({ listThreads: vi.fn(), listTopics: vi.fn() }))

vi.mock('@/lib/api/topic', () => ({ listTopics: api.listTopics }))
vi.mock('@/lib/api/thread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/thread')>()),
  listThreads: api.listThreads
}))

const thread = (id: string, title: string, topicId = 'react'): Thread => ({
  id,
  topicId,
  title,
  messageCount: 2,
  createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString()
})

afterEach(() => {
  vi.clearAllMocks()
})

function setup() {
  api.listTopics.mockResolvedValue({
    topics: [
      { id: 'react', name: 'React' },
      { id: 'sql', name: 'SQL' }
    ]
  })
}

describe('ThreadList', () => {
  it('shows the empty state and a New thread link', async () => {
    setup()
    api.listThreads.mockResolvedValue({ threads: [], nextCursor: null })
    renderWithQuery(<ThreadList />)

    expect(await screen.findByText('No threads yet. Ask your first question.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New thread' })).toHaveAttribute('href', '/thread')
  })

  it('lists title, topic and relative time and marks the active thread', async () => {
    setup()
    api.listThreads.mockResolvedValue({
      threads: [thread('a', 'Closures'), thread('b', 'Joins', 'sql')],
      nextCursor: null
    })
    renderWithQuery(<ThreadList activeId="b" />)

    const active = await screen.findByRole('link', { name: /Joins/ })
    expect(active).toHaveAttribute('href', '/thread/b')
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(await within(active).findByText('SQL')).toBeInTheDocument()
    expect(within(active).getByText('2h ago')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Closures/ })).not.toHaveAttribute('aria-current')
  })

  it('loads the next page with the cursor', async () => {
    setup()
    api.listThreads
      .mockResolvedValueOnce({ threads: [thread('a', 'First')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ threads: [thread('b', 'Second')], nextCursor: null })
    renderWithQuery(<ThreadList />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('link', { name: /Second/ })).toBeInTheDocument()
    expect(api.listThreads).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }))
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('offers a retry when the list cannot load', async () => {
    setup()
    api.listThreads.mockRejectedValue(
      new ApiError({ status: 0, code: 'network_error', message: 'x' })
    )
    renderWithQuery(<ThreadList />)

    expect(await screen.findByText(/Can't reach the server/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
