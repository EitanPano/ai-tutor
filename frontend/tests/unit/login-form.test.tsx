import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from '@/component/auth/login-form'
import { errorResponse, jsonResponse, renderWithQuery } from './test-utils'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const user = { id: 'u1', email: 'a@b.co', displayName: 'Ada', timeZone: 'UTC', createdAt: 'x' }

async function submit(email = 'a@b.co', password = 'secret-pass') {
  const typist = userEvent.setup()
  await typist.type(screen.getByLabelText('Email'), email)
  await typist.type(screen.getByLabelText('Password'), password)
  await typist.click(screen.getByRole('button', { name: 'Log in' }))
}

/** POST /api/session logs in; the follow-up GET /api/session returns the user. */
function stubApi(login: Response) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(init?.method === 'POST' ? login : jsonResponse(200, { user }))
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  router.replace.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginForm', () => {
  it('shows an inline message for invalid credentials and does not navigate', async () => {
    stubApi(errorResponse(401, 'invalid_credentials', 'Wrong email or password.'))
    renderWithQuery(<LoginForm />)

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('goes to the requested relative page after a successful login', async () => {
    const fetchMock = stubApi(jsonResponse(200, { user }))
    renderWithQuery(<LoginForm next="/progress" />)

    await submit()

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/progress'))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co', password: 'secret-pass' })
  })

  it('defaults to /thread without a next parameter', async () => {
    stubApi(jsonResponse(200, { user }))
    renderWithQuery(<LoginForm />)

    await submit()

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/thread'))
  })

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com'])(
    'ignores the unsafe next value %s',
    async (next) => {
      stubApi(jsonResponse(200, { user }))
      renderWithQuery(<LoginForm next={next} />)

      await submit()

      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/thread'))
    }
  )

  it('asks for missing fields without calling the API', async () => {
    const fetchMock = stubApi(jsonResponse(200, { user }))
    renderWithQuery(<LoginForm />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Log in' }))

    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email.')
    expect(screen.getByLabelText('Email')).toBeInvalid()
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
