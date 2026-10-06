'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon } from '@/lib/icon'

const THEME = 'github-dark-default'

// Finished blocks are kept so the swap from the streamed message to the saved one does not
// flash back to unhighlighted code.
const highlighted = new Map<string, string>()

async function highlight(code: string, language: string): Promise<string> {
  // Loaded on demand: Shiki and its grammars stay out of the main bundle.
  const { codeToHtml, bundledLanguages } = await import('shiki')
  const lang = Object.hasOwn(bundledLanguages, language) ? language : 'text'
  return codeToHtml(code, {
    lang,
    theme: THEME,
    // The block supplies its own background from the `--code` token.
    transformers: [
      {
        pre(node) {
          delete node.properties.style
        }
      }
    ]
  })
}

// The highlighted markup brings its own `<pre>`; the fallback is a `<pre>` itself.
const highlightedClass =
  '[&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-relaxed [&_code]:font-mono'
const plainClass = 'm-0 overflow-x-auto p-4 font-mono text-sm leading-relaxed'

type CodeBlockProps = {
  code: string
  /** The fence's info string; `text` when absent. */
  language?: string
  /** Highlighting waits until the message stops streaming. */
  streaming?: boolean
}

export function CodeBlock({ code, language, streaming = false }: CodeBlockProps) {
  const lang = (language || 'text').toLowerCase()
  const text = code.replace(/\n$/, '')
  const key = `${lang}\u0000${text}`
  const [loaded, setLoaded] = useState<{ key: string; html: string }>()
  const html = highlighted.get(key) ?? (loaded?.key === key ? loaded.html : undefined)

  useEffect(() => {
    if (streaming || highlighted.has(key)) return
    let cancelled = false
    highlight(text, lang)
      .then((result) => {
        highlighted.set(key, result)
        if (!cancelled) setLoaded({ key, html: result })
      })
      .catch(() => undefined) // The plain block stays: highlighting is only a nicety.
    return () => {
      cancelled = true
    }
  }, [streaming, key, text, lang])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied')
    } catch {
      toast.error("Couldn't copy. Select the code and copy it by hand.")
    }
  }

  return (
    <figure className="not-prose my-5 overflow-hidden rounded-md bg-code text-code-ink">
      <figcaption className="flex items-center justify-between gap-3 border-b border-code-ink/15 py-1.5 pr-2 pl-4 text-sm">
        <span className="font-mono text-code-ink/70">{lang}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-semibold text-code-ink hover:bg-code-ink/15"
        >
          <CopyIcon aria-hidden="true" className="size-4" />
          Copy
        </button>
      </figcaption>
      {html ? (
        // Shiki's generated highlighting markup (it escapes the token text), not authored inline styles.
        <div className={highlightedClass} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={plainClass} tabIndex={0}>
          <code>{text}</code>
        </pre>
      )}
    </figure>
  )
}
