import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/component/shell/app-shell'
import { ApiError } from '@/lib/api/error'
import { SESSION_KEY } from '@/lib/session'

const api = vi.hoisted(() => ({ getSession: vi.fn(), logOut: vi.fn() }))

vi.mock('@/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/session')>()),
  getSession: api.getSession,
  logOut: api.logOut
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/thread',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() })
}))

const session = {
  user: {
    id: 'u1',
    email: 'a@example.com',
    displayName: 'Ada',
    timeZone: 'Europe/Paris',
    createdAt: '2026-09-01T10:00:00Z'
  }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </QueryClientProvider>
  )
  return client
}

describe('AppShell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the page when a background session refetch fails', async () => {
    api.getSession.mockResolvedValueOnce(session)
    const client = setup()
    expect(await screen.findByText('page content')).toBeInTheDocument()

    api.getSession.mockRejectedValue(
      new ApiError({ status: 503, code: 'network_error', message: 'down' })
    )
    await act(() => client.refetchQueries({ queryKey: SESSION_KEY }))

    await waitFor(() => expect(client.getQueryState(SESSION_KEY)?.status).toBe('error'))
    expect(screen.getByText('page content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows the error state with Retry when the first load fails', async () => {
    api.getSession.mockRejectedValue(
      new ApiError({ status: 503, code: 'network_error', message: 'down' })
    )
    setup()

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('page content')).not.toBeInTheDocument()
  })
})
