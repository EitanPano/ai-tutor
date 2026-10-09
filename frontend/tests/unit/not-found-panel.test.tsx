import { render, screen } from '@testing-library/react'
import type { SVGProps } from 'react'
import { describe, expect, it } from 'vitest'
import { NotFoundPanel } from '@/component/ui/not-found-panel'

const GoneIcon = (props: SVGProps<SVGSVGElement>) => <svg data-testid="gone-icon" {...props} />

describe('NotFoundPanel', () => {
  it('says what is gone, shows its icon and leads back to the threads instead of a Retry', () => {
    render(
      <NotFoundPanel icon={GoneIcon}>This guide doesn&apos;t exist or was deleted.</NotFoundPanel>
    )

    expect(screen.getByText("This guide doesn't exist or was deleted.")).toBeInTheDocument()
    expect(screen.getByTestId('gone-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: 'Back to threads' })).toHaveAttribute('href', '/thread')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
