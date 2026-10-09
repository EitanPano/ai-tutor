import { useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/providers'
import { ApiError } from '@/lib/api/error'

const hardRedirect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hard-redirect', () => ({ hardRedirect }))

function Failing({ error }: { error: ApiError }) {
  const query = useQuery({
    queryKey: ['thing'],
    queryFn: () => Promise.reject(error)
  })
  return <p>{query.isError ? 'failed' : 'loading'}</p>
}

const failure = (status: number, code: string) =>
  new ApiError({ status, code, message: 'x', requestId: 'r' })

beforeEach(() => {
  hardRedirect.mockReset()
})

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('Providers 401 handling', () => {
  it('sends the user to /login with the current path when a query is unauthenticated', async () => {
    window.history.pushState({}, '', '/thread/abc?x=1')
    render(
      <Providers>
        <Failing error={failure(401, 'unauthenticated')} />
      </Providers>
    )

    await waitFor(() =>
      expect(hardRedirect).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent('/thread/abc?x=1')}`
      )
    )
  })

  it('does not fetch an unauthenticated query again while the redirect is pending', async () => {
    window.history.pushState({}, '', '/thread')
    const queryFn = vi.fn(() => Promise.reject(failure(401, 'unauthenticated')))
    function Counting() {
      const query = useQuery({ queryKey: ['counted'], queryFn })
      return <p>{query.isError ? 'failed' : 'loading'}</p>
    }
    render(
      <Providers>
        <Counting />
      </Providers>
    )

    expect(await screen.findByText('failed')).toBeInTheDocument()
    // Let any refetch the redirect set off settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('does not redirect on the auth pages, which expect a 401', async () => {
    window.history.pushState({}, '', '/login')
    render(
      <Providers>
        <Failing error={failure(401, 'unauthenticated')} />
      </Providers>
    )

    expect(await screen.findByText('failed')).toBeInTheDocument()
    expect(hardRedirect).not.toHaveBeenCalled()
  })

  it('does not redirect on other errors such as invalid_credentials', async () => {
    window.history.pushState({}, '', '/thread')
    render(
      <Providers>
        <Failing error={failure(401, 'invalid_credentials')} />
      </Providers>
    )

    expect(await screen.findByText('failed')).toBeInTheDocument()
    expect(hardRedirect).not.toHaveBeenCalled()
  })
})
