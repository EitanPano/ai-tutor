'use client'

import {
  isValidElement,
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

export function Markdown({ children, streaming = false, className = '' }: MarkdownProps) {
  const components: Components = {
    pre({ children: preChildren }) {
      const code = isValidElement(preChildren)
        ? (preChildren as ReactElement<ComponentPropsWithoutRef<'code'>>)
        : undefined
      const language = /language-([^\s]+)/.exec(code?.props.className ?? '')?.[1]
      return <CodeBlock code={textOf(preChildren)} language={language} streaming={streaming} />
    },
    a({ href, children: linkChildren }) {
      // A URL react-markdown refused (such as `javascript:`) arrives empty: show it as text.
      if (!href) return <span>{linkChildren}</span>
      const external = /^https?:\/\//i.test(href)
      return (
        <a href={href} {...(external && { target: '_blank', rel: 'noopener noreferrer' })}>
          {linkChildren}
        </a>
      )
    },
    // Remote images in model output are a tracking and exfiltration channel: show the alt text.
    img({ alt }) {
      return <span>{alt ? `[image: ${alt}]` : '[image]'}</span>
    }
  }

  return (
    <div className={`${proseClass} ${streaming ? 'streaming-caret' : ''} ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
