import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/error'
import { useRetryToast } from '@/lib/retry-toast'

const toast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

afterEach(() => {
  vi.clearAllMocks()
})

const failure = (code: string) => new ApiError({ status: 502, code, message: 'x' })

type ToastOptions = { action?: { label: string; onClick: () => void } }
const optionsOf = (call: number) => toast.error.mock.calls[call]![1] as ToastOptions

describe('useRetryToast', () => {
  it('toasts the error in words, with a Retry that runs the given function', () => {
    const { result } = renderHook(() => useRetryToast('generate'))
    const retry = vi.fn()

    act(() => result.current(failure('ai_invalid_output'), retry))

    expect(toast.error).toHaveBeenCalledWith(
      'The tutor produced something unusable. Try again.',
      expect.anything()
    )
    expect(optionsOf(0).action?.label).toBe('Retry')
    optionsOf(0).action!.onClick()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['generate', 'ai_refused'],
    ['ask', 'ai_invalid_output'],
    ['ask', 'thread_full']
  ] as const)('offers no Retry for a %s failure with %s', (kind, code) => {
    const { result } = renderHook(() => useRetryToast(kind))

    act(() => result.current(failure(code), vi.fn()))

    expect(toast.error).toHaveBeenCalledWith(expect.any(String), {})
  })

  it('offers Retry for what isRetryable allows of its kind', () => {
    const { result } = renderHook(() => useRetryToast('ask'))

    act(() => result.current(failure('stream_interrupted'), vi.fn()))

    expect(optionsOf(0).action?.label).toBe('Retry')
  })

  it('dismisses every toast it raised when the page goes, and its Retry then does nothing', () => {
    toast.error.mockReturnValueOnce('toast-1').mockReturnValueOnce('toast-2')
    const { result, unmount } = renderHook(() => useRetryToast('generate'))
    const retry = vi.fn()

    act(() => result.current(failure('network_error'), retry))
    act(() => result.current(failure('network_error'), retry))
    unmount()

    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
    expect(toast.dismiss).toHaveBeenCalledWith('toast-2')
    optionsOf(0).action!.onClick()
    expect(retry).not.toHaveBeenCalled()
  })

  it('never dismisses an undefined id, which would clear every toast on screen', () => {
    toast.error.mockReturnValue(undefined)
    const { result, unmount } = renderHook(() => useRetryToast('generate'))

    act(() => result.current(failure('ai_refused'), vi.fn()))
    unmount()

    expect(toast.dismiss).not.toHaveBeenCalled()
  })

  it('returns the same function across renders', () => {
    const { result, rerender } = renderHook(() => useRetryToast('ask'))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('still toasts a failure that lands after the page is gone, but without a Retry', () => {
    toast.error.mockReturnValue('late')
    const { result, unmount } = renderHook(() => useRetryToast('generate'))
    const showError = result.current
    unmount()

    showError(failure('network_error'), vi.fn())

    expect(toast.error).toHaveBeenCalledWith(
      "Can't reach the server. Make sure the API is running and you opened http://localhost:3000.",
      {}
    )
    expect(toast.dismiss).not.toHaveBeenCalled()
  })

  it('offers a working Retry under StrictMode, after the dev-only effect double run', () => {
    const { result } = renderHook(() => useRetryToast('generate'), { wrapper: StrictMode })
    const retry = vi.fn()

    act(() => result.current(failure('network_error'), retry))

    expect(optionsOf(0).action?.label).toBe('Retry')
    optionsOf(0).action!.onClick()
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
