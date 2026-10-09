import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Markdown } from '@/component/markdown/markdown'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

// QA adversarial pass: hostile and degenerate markdown must stay inert and must not crash.

const BAD_SCHEME = /^\s*(javascript|data|vbscript):/i

function hrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
}

describe('Markdown (adversarial)', () => {
  it.each([
    ['javascript', '[x](javascript:alert(1))'],
    ['mixed-case javascript', '[x](JaVaScRiPt:alert(1))'],
    ['entity-encoded javascript', '[x](&#106;avascript:alert(1))'],
    ['tab-split javascript', '[x](java\tscript:alert(1))'],
    ['data', '[x](data:text/html,<script>alert(1)</script>)'],
    ['vbscript', '[x](vbscript:msgbox(1))'],
    ['reference style', '[x][r]\n\n[r]: javascript:alert(1)'],
    ['autolink', '<javascript:alert(1)>']
  ])('never emits a %s link target', (_name, source) => {
    const { container } = render(<Markdown>{source}</Markdown>)
    for (const href of hrefs(container)) expect(href).not.toMatch(BAD_SCHEME)
    expect(container.querySelector('script')).toBeNull()
  })

  it.each([
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload=alert(1)></svg>',
    '<a href="javascript:alert(1)" onclick="alert(2)">x</a>',
    '<style>body{display:none}</style>',
    '<form action="https://evil.example"><input name=p></form>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">'
  ])('turns raw HTML into text and creates no element: %s', (source) => {
    const { container } = render(<Markdown>{source}</Markdown>)
    for (const tag of ['iframe', 'svg', 'style', 'form', 'input', 'meta']) {
      expect(container.querySelector(tag), tag).toBeNull()
    }
    expect(container.querySelector('[onclick], [onload], [onerror]')).toBeNull()
  })

  it('does not load a remote or javascript: image', () => {
    const { container } = render(
      <Markdown>{'![a](https://evil.example/x.png)\n\n![b](javascript:alert(1))'}</Markdown>
    )
    for (const img of container.querySelectorAll('img')) {
      expect(img.getAttribute('src') ?? '').not.toMatch(/^(https?:|javascript:)/i)
    }
  })

  it('renders an empty string, whitespace and a lone fence without throwing', () => {
    for (const source of ['', '   \n\n', '```', '```ts', '~~~\n', '`', '**', '[', '](']) {
      expect(() => render(<Markdown>{source}</Markdown>), JSON.stringify(source)).not.toThrow()
    }
  })

  it('renders an unterminated code fence while streaming', () => {
    const { container } = render(<Markdown isStreaming>{'```ts\nconst a = 1'}</Markdown>)
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('handles a 20,000-character answer with many code fences and emoji without throwing', () => {
    const block = '```ts\nconst x = 1 // 🚀\n```\n\ntext 山田 🧑‍💻\n\n'
    const source = block.repeat(Math.ceil(20_000 / block.length))
    const { container } = render(<Markdown>{source}</Markdown>)
    expect(container.querySelectorAll('pre').length).toBeGreaterThan(100)
  })

  it('handles deeply nested lists and block quotes without throwing', () => {
    const quote = `${'> '.repeat(200)}deep`
    const list = Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n')
    expect(() => render(<Markdown>{quote}</Markdown>)).not.toThrow()
    expect(() => render(<Markdown>{list}</Markdown>)).not.toThrow()
  })

  it('marks external links so they cannot reach window.opener', () => {
    const { container } = render(<Markdown>{'[x](https://example.com)'}</Markdown>)
    const link = container.querySelector('a[href="https://example.com"]')
    expect(link?.getAttribute('rel') ?? '').toMatch(/noopener/)
  })
})
