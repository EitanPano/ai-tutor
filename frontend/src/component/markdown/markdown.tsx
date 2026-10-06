'use client'

import {
  createContext,
  isValidElement,
  memo,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './code-block'
import { remarkNoRawHtml } from './no-raw-html'

type MarkdownProps = {
  children: string
  /** True while the text is still arriving: code highlighting waits for the end. */
  streaming?: boolean
  /** Phrasing content only (a `span`, no paragraphs), for text that lives inside a label or legend. */
  inline?: boolean
  className?: string
}

const plugins = [remarkGfm, remarkNoRawHtml]

const proseClass =
  'prose-notebook prose-code:before:content-none prose-code:after:content-none prose-code:rounded-sm prose-code:bg-ink/10 prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.9em] prose-code:font-normal'

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

const StreamingContext = createContext(false)

function Pre({ children }: ComponentPropsWithoutRef<'pre'>) {
  const streaming = useContext(StreamingContext)
  const code = isValidElement(children)
    ? (children as ReactElement<ComponentPropsWithoutRef<'code'>>)
    : undefined
  const language = /language-([^\s]+)/.exec(code?.props.className ?? '')?.[1]
  return <CodeBlock code={textOf(children)} language={language} streaming={streaming} />
}

function Anchor({ href, children }: ComponentPropsWithoutRef<'a'>) {
  // A URL react-markdown refused (such as `javascript:`) arrives empty: show it as text.
  if (!href) return <span>{children}</span>
  const external = /^https?:\/\//i.test(href)
  return (
    <a href={href} {...(external && { target: '_blank', rel: 'noopener noreferrer' })}>
      {children}
    </a>
  )
}

// Remote images in model output are a tracking and exfiltration channel: show the alt text.
function Image({ alt }: ComponentPropsWithoutRef<'img'>) {
  return <span>{alt ? `[image: ${alt}]` : '[image]'}</span>
}

// Module scope on purpose: a new map per render would remount every code block, link and image
// on each streamed delta, losing Copy clicks, text selection and the highlighted markup.
const components: Components = { pre: Pre, a: Anchor, img: Image }
// Paragraphs dissolve into their text, so the markup stays valid inside a `label` or `legend`.
const inlineComponents: Components = { ...components, p: ({ children }) => <>{children}</> }

export const Markdown = memo(function Markdown({
  children,
  streaming = false,
  inline = false,
  className = ''
}: MarkdownProps) {
  const Wrapper = inline ? 'span' : 'div'
  return (
    <StreamingContext value={streaming}>
      <Wrapper
        className={`${proseClass} ${streaming ? 'streaming-caret' : ''} ${className}`.trim()}
      >
        <ReactMarkdown remarkPlugins={plugins} components={inline ? inlineComponents : components}>
          {children}
        </ReactMarkdown>
      </Wrapper>
    </StreamingContext>
  )
})
