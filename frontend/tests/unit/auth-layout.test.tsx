import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthLayout from '@/app/(auth)/layout'
import { errorResponse, jsonResponse, renderWithQuery } from './test-utils'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
const cookieJar = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ has: (name: string) => cookieJar.names.includes(name) })
}))

const user = { id: 'u1', email: 'a@b.co', displayName: 'Ada', timeZone: 'Europe/Berlin' }

beforeEach(() => {
  router.replace.mockReset()
  cookieJar.names = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthLayout session probe', () => {
  it('does not call the session API for a visitor without a session cookie', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(errorResponse(401, 'unauthenticated')))
    vi.stubGlobal('fetch', fetchMock)

    renderWithQuery(await AuthLayout({ children: <p>the form</p> }))

    expect(screen.getByText('the form')).toBeInTheDocument()
    // Give a mount-time probe the chance to fire if there were one.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('still sends a signed-in visitor on to /thread', async () => {
    cookieJar.names = ['sid']
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { user })))
    vi.stubGlobal('fetch', fetchMock)

    renderWithQuery(await AuthLayout({ children: <p>the form</p> }))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/thread'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the form in place when the API rejects a stale session cookie', async () => {
    cookieJar.names = ['sid']
    const fetchMock = vi.fn(() => Promise.resolve(errorResponse(401, 'unauthenticated')))
    vi.stubGlobal('fetch', fetchMock)

    renderWithQuery(await AuthLayout({ children: <p>the form</p> }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.getByText('the form')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })
})
