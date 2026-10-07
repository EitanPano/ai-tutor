import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AppError from '@/app/(app)/error'
import GuideLoading from '@/app/(app)/guide/[id]/loading'
import ProgressLoading from '@/app/(app)/progress/loading'
import QuizLoading from '@/app/(app)/quiz/[id]/loading'
import ThreadLoading from '@/app/(app)/thread/[id]/loading'
import GlobalError from '@/app/global-error'
import NotFound from '@/app/not-found'

describe('error pages', () => {
  it('app error page says something broke without exposing the error, and retries on click', async () => {
    const retry = vi.fn()
    render(<AppError error={new Error('secret detail')} retry={retry} />)

    expect(screen.getByText('Something broke on this page.')).toBeInTheDocument()
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('global error page retries on click and hides the error message', async () => {
    const retry = vi.fn()
    // The component renders its own <html>; React warns when it is nested in the test container.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<GlobalError error={new Error('secret detail')} retry={retry} />)
    spy.mockRestore()

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('not-found links back to /thread', () => {
    render(<NotFound />)
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
  })
})

describe('loading pages', () => {
  it.each([
    ['thread', ThreadLoading, 'Loading thread'],
    ['guide', GuideLoading, 'Loading guide'],
    ['quiz', QuizLoading, 'Loading quiz'],
    ['progress', ProgressLoading, 'Loading progress']
  ])('%s shows its skeleton', (_name, Loading, label) => {
    render(<Loading />)
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-busy', 'true')
  })
})
