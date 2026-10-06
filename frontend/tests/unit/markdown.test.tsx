import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '@/component/markdown/markdown'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

beforeEach(() => {
  toast.mockClear()
})

describe('Markdown', () => {
  it('renders raw HTML as visible text and creates no element (AC12)', () => {
    const { container } = render(<Markdown>{'Look: <img src=x onerror=alert(1)>'}</Markdown>)

    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('renders a block of raw HTML as text too', () => {
    const { container } = render(<Markdown>{'<script>alert(1)</script>\n\nafter'}</Markdown>)

    expect(container.querySelector('script')).toBeNull()
    expect(container).toHaveTextContent('<script>alert(1)</script>')
  })

  it('renders a fenced block with its language and a Copy button', async () => {
    const typist = userEvent.setup()
    const { container } = render(<Markdown streaming>{'```ts\nconst a = 1\n```'}</Markdown>)

    expect(container.querySelector('pre > code')).toHaveTextContent('const a = 1')
    expect(screen.getByText('ts')).toBeInTheDocument()

    await typist.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await navigator.clipboard.readText()).toBe('const a = 1')
    expect(toast).toHaveBeenCalledWith('Copied')
  })

  it('neutralises a javascript: link', () => {
    const { container } = render(<Markdown>{'[click](javascript:alert(1))'}</Markdown>)

    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container).toHaveTextContent('click')
  })

  it('opens external links safely in a new tab', () => {
    render(<Markdown>{'[docs](https://react.dev)'}</Markdown>)

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not load remote images', () => {
    const { container } = render(<Markdown>{'![diagram](https://evil.test/x.png)'}</Markdown>)

    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('[image: diagram]')
  })

  it('renders GFM tables', () => {
    render(<Markdown>{'| a | b |\n|---|---|\n| 1 | 2 |'}</Markdown>)

    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
