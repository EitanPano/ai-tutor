import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Transcript } from '@/component/thread/transcript'
import type { Message } from '@/lib/api/thread'

const question = (content: string): Message => ({
  id: 'u1',
  threadId: 't1',
  role: 'user',
  content,
  status: 'complete',
  stopReason: null,
  createdAt: '2026-10-06T10:00:00Z'
})

const renderQuestion = (content: string) => {
  const view = render(<Transcript messages={[question(content)]} asking={undefined} />)
  return { ...view, article: screen.getByRole('article', { name: 'Your question' }) }
}

describe('Transcript question', () => {
  it('keeps the line breaks of unfenced code and shows markup characters literally', () => {
    const code = 'class A:\n  def __init__(self):\n    pass'
    const { article } = renderQuestion(code)
    const text = article.querySelector('p')!
    expect(text.textContent).toBe(code)
    expect(text).toHaveClass('whitespace-pre-wrap')
    expect(article.querySelector('strong')).toBeNull()
  })

  it('shows a header line as text, not a heading', () => {
    const { article } = renderQuestion('#include <stdio.h>\nint main() {}')
    expect(article.querySelector('h1')).toBeNull()
    expect(article).toHaveTextContent('#include <stdio.h>')
  })

  it('renders Markdown, with a code block, when the question has a fence', () => {
    const { article } = renderQuestion('What does this do?\n\n```js\nconst a = 1\n```')
    expect(article.querySelector('pre code')).not.toBeNull()
  })

  it('renders a tilde fence as Markdown too', () => {
    const { article } = renderQuestion('Explain:\n\n~~~\nx = 1\n~~~')
    expect(article.querySelector('pre')).not.toBeNull()
  })

  it.each([
    ['unfenced', '<img src=x onerror=alert(1)>\nwhy?'],
    ['fenced', '<img src=x onerror=alert(1)>\n\n```\ncode\n```']
  ])('keeps raw HTML inert (%s)', (_name, content) => {
    const { article, container } = renderQuestion(content)
    expect(container.querySelector('img')).toBeNull()
    expect(article).toHaveTextContent('<img src=x onerror=alert(1)>')
  })
})
