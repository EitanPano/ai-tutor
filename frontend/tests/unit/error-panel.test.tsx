import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Link from 'next/link'
import type { SVGProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorPanel } from '@/component/ui/error-panel'

const GoneIcon = (props: SVGProps<SVGSVGElement>) => <svg data-testid="gone-icon" {...props} />

describe('ErrorPanel', () => {
  it('shows the message and a Retry button that calls onRetry with no arguments', async () => {
    const onRetry = vi.fn()
    render(<ErrorPanel onRetry={onRetry}>The server hit a problem.</ErrorPanel>)

    expect(screen.getByText('The server hit a problem.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith()
  })

  it('names the button with retryLabel', () => {
    render(
      <ErrorPanel onRetry={vi.fn()} retryLabel="Try again">
        Something went wrong.
      </ErrorPanel>
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the given icon and action instead of Retry, for a thing that is gone', () => {
    render(
      <ErrorPanel
        icon={GoneIcon}
        action={<Link href="/thread">Back to threads</Link>}
        onRetry={vi.fn()}
      >
        This guide doesn&apos;t exist or was deleted.
      </ErrorPanel>
    )

    expect(screen.getByTestId('gone-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('has no action without onRetry or action', () => {
    render(<ErrorPanel>Nothing to do.</ErrorPanel>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders its sheet as the given element', () => {
    render(<ErrorPanel as="main">Something went wrong.</ErrorPanel>)
    expect(screen.getByRole('main')).toHaveTextContent('Something went wrong.')
  })
})
