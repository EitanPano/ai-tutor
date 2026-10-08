import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkeletonBar, SkeletonCard, SkeletonSection } from '@/component/ui/skeleton'

describe('SkeletonSection', () => {
  it('is a busy region named by its label, not a landmark', () => {
    render(
      <SkeletonSection label="Loading guide">
        <SkeletonBar className="h-9 w-2/3" />
      </SkeletonSection>
    )

    const section = screen.getByLabelText('Loading guide')
    expect(section).toHaveAttribute('aria-busy', 'true')
    expect(section.tagName).toBe('DIV')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('spaces its children with gap-5 unless told otherwise', () => {
    render(
      <>
        <SkeletonSection label="Loading page">
          <SkeletonBar className="h-9" />
        </SkeletonSection>
        <SkeletonSection label="Loading list" gap={2}>
          <SkeletonCard className="h-16" />
        </SkeletonSection>
      </>
    )

    expect(screen.getByLabelText('Loading page')).toHaveClass('flex', 'flex-col', 'gap-5')
    expect(screen.getByLabelText('Loading list')).toHaveClass('gap-2')
    expect(screen.getByLabelText('Loading list')).not.toHaveClass('gap-5')
  })
})

describe('SkeletonBar and SkeletonCard', () => {
  it('pulse, take their size from className and carry no text', () => {
    render(
      <SkeletonSection label="Loading">
        <SkeletonBar className="h-9 w-2/3" />
        <SkeletonCard className="h-64" />
      </SkeletonSection>
    )

    const [bar, card] = Array.from(screen.getByLabelText('Loading').children)
    expect(bar).toHaveClass('animate-pulse', 'h-9', 'w-2/3')
    expect(card).toHaveClass('animate-pulse', 'h-64', 'bg-sheet')
    expect(screen.getByLabelText('Loading').textContent).toBe('')
  })
})
