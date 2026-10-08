import { render, screen } from '@testing-library/react'
import type { SVGProps } from 'react'
import { describe, expect, it } from 'vitest'
import { BackLink } from '@/component/ui/back-link'
import { BackIcon } from '@/lib/icon'

const HomeIcon = (props: SVGProps<SVGSVGElement>) => <svg data-testid="home-icon" {...props} />

describe('BackLink', () => {
  it('links back, named by its text alone, with the back arrow as decoration', () => {
    const { container } = render(<BackLink href="/thread/t1">Back to the conversation</BackLink>)
    const { container: arrow } = render(<BackIcon />)

    const link = screen.getByRole('link', { name: 'Back to the conversation' })
    expect(link).toHaveAttribute('href', '/thread/t1')
    const icon = container.querySelector('svg')!
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon.innerHTML).toBe(arrow.querySelector('svg')!.innerHTML)
  })

  it('takes another icon and extra classes', () => {
    render(
      <BackLink href="/thread" icon={HomeIcon} className="lg:hidden">
        Threads
      </BackLink>
    )

    const link = screen.getByRole('link', { name: 'Threads' })
    expect(link).toHaveClass('lg:hidden', 'inline-flex')
    expect(screen.getByTestId('home-icon')).toHaveAttribute('aria-hidden', 'true')
  })
})
