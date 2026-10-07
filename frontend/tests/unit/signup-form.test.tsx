import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupForm } from '@/component/auth/signup-form'
import { errorResponse, jsonResponse, renderWithQuery } from './test-utils'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const user = { id: 'u1', email: 'a@b.co', displayName: 'Ada', timeZone: 'Europe/Berlin' }

async function fill(typist: ReturnType<typeof userEvent.setup>) {
  await typist.type(screen.getByLabelText('Display name'), 'Ada')
  await typist.type(screen.getByLabelText('Email'), 'ada@example.com')
  await typist.type(screen.getByLabelText('Password'), 'long-enough-1')
}

function stubApi(signup: Response) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(init?.method === 'POST' ? signup : jsonResponse(200, { user }))
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  router.replace.mockReset()
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'Europe/Berlin'
  } as Intl.ResolvedDateTimeFormatOptions)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SignupForm', () => {
  it('shows the detected time zone and sends it with the request', async () => {
    const fetchMock = stubApi(jsonResponse(201, { user }))
    renderWithQuery(<SignupForm />)
    const typist = userEvent.setup()

    expect(await screen.findByText(/Time zone: Europe\/Berlin/)).toBeInTheDocument()
    await fill(typist)
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/thread'))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:4000/api/user')
    expect(JSON.parse(init.body as string)).toEqual({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'long-enough-1',
      timeZone: 'Europe/Berlin'
    })
  })

  it('renders email_taken under the email field with a log in link', async () => {
    stubApi(errorResponse(409, 'email_taken'))
    renderWithQuery(<SignupForm />)
    const typist = userEvent.setup()

    await fill(typist)
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    const email = screen.getByLabelText('Email')
    await waitFor(() => expect(email).toBeInvalid())
    expect(email).toHaveAccessibleDescription(/already exists/)
    const links = screen.getAllByRole('link', { name: 'Log in' })
    expect(links.some((link) => link.getAttribute('href') === '/login')).toBe(true)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('renders server field issues under the matching field', async () => {
    stubApi(
      errorResponse(400, 'validation_failed', 'The request is invalid.', {
        issues: [{ path: ['email'], message: 'Invalid email address' }]
      })
    )
    renderWithQuery(<SignupForm />)
    const typist = userEvent.setup()

    await fill(typist)
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Invalid email address')
    )
    expect(screen.getByLabelText('Password')).not.toBeInvalid()
  })

  it('checks the password length before calling the API', async () => {
    const fetchMock = stubApi(jsonResponse(201, { user }))
    renderWithQuery(<SignupForm />)
    const typist = userEvent.setup()

    await typist.type(screen.getByLabelText('Display name'), 'Ada')
    await typist.type(screen.getByLabelText('Email'), 'ada@example.com')
    await typist.type(screen.getByLabelText('Password'), 'short')
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 8 characters Use at least 8 characters.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SignupForm time zone issue', () => {
  it('shows a rejected time zone instead of failing silently', async () => {
    stubApi(
      errorResponse(400, 'validation_failed', 'The request is invalid.', {
        issues: [{ path: ['timeZone'], message: 'Unknown time zone' }]
      })
    )
    renderWithQuery(<SignupForm />)
    const typist = userEvent.setup()

    await fill(typist)
    await typist.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server did not accept the time zone Europe/Berlin: Unknown time zone'
    )
    expect(router.replace).not.toHaveBeenCalled()
  })
})
