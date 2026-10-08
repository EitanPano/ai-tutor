import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthForm } from '@/component/auth/use-auth-form'
import { ApiError } from '@/lib/api/error'
import { SESSION_KEY } from '@/lib/session'

const toast = vi.hoisted(() => ({ error: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

afterEach(() => {
  vi.clearAllMocks()
})

type Input = { email: string }

function setup(send: (input: Input) => Promise<unknown>, onErrorCode = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useAuthForm({ send, nextPath: '/progress', onErrorCode }), {
    wrapper
  })
  return { ...hook, invalidate }
}

const apiError = (code: string, details?: Record<string, unknown>) =>
  new ApiError({ status: 400, code, message: 'x', details })

describe('useAuthForm', () => {
  it('refreshes the session everywhere, then goes to nextPath', async () => {
    const send = vi.fn().mockResolvedValue({})
    const { result, invalidate } = setup(send)

    act(() => result.current.submit({}, { email: 'a@b.co' }))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/progress'))
    expect(send.mock.calls[0]![0]).toEqual({ email: 'a@b.co' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SESSION_KEY, refetchType: 'all' })
  })

  it('shows client-side issues and sends nothing while there are any', () => {
    const send = vi.fn()
    const { result } = setup(send)

    act(() => result.current.submit({ email: 'Enter your email.' }, { email: '' }))

    expect(result.current.issues).toEqual({ email: 'Enter your email.' })
    expect(send).not.toHaveBeenCalled()
  })

  it('turns validation_failed into field issues', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        apiError('validation_failed', { issues: [{ path: ['email'], message: 'Invalid email' }] })
      )
    const { result } = setup(send)

    act(() => result.current.submit({}, { email: 'x' }))

    await waitFor(() => expect(result.current.issues).toEqual({ email: 'Invalid email' }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("hands a code the form expects to the form's own handler", async () => {
    const onTaken = vi.fn()
    const failure = apiError('email_taken')
    const { result } = setup(vi.fn().mockRejectedValue(failure), { email_taken: onTaken })

    act(() => result.current.submit({}, { email: 'a@b.co' }))

    await waitFor(() => expect(onTaken).toHaveBeenCalledWith(failure))
    expect(toast.error).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it.each([
    ['an unexpected code', apiError('rate_limited'), 'Too many attempts. Try again later.'],
    ['a prototype key as code', apiError('constructor'), 'x'],
    ['a value that is not an ApiError', new Error('boom'), 'Something went wrong. Try again.']
  ])('toasts %s', async (_name, failure, sentence) => {
    const { result } = setup(vi.fn().mockRejectedValue(failure))

    act(() => result.current.submit({}, { email: 'a@b.co' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(sentence))
  })
})
