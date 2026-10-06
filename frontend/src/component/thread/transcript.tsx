import type { ReactNode } from 'react'
import { Markdown } from '@/component/markdown/markdown'
import { Button } from '@/component/ui/button'
import { isPending, type Message } from '@/lib/api/thread'
import { RetryIcon } from '@/lib/icon'
import type { Asking } from './use-ask'

function Question({ content, dimmed = false }: { content: string; dimmed?: boolean }) {
  return (
    <article
      aria-label="Your question"
      className={`border-l-2 border-ink bg-ink/5 px-4 py-2 ${dimmed ? 'opacity-60' : ''}`}
    >
      <Markdown className="prose-sm">{content}</Markdown>
    </article>
  )
}

function Note({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
      <p>{children}</p>
      {action}
    </div>
  )
}

function noteFor(message: Message): string | null {
  if (message.status === 'failed') {
    return message.stopReason === 'refusal'
      ? "The tutor can't help with that question. Try rephrasing it."
      : 'This answer failed.'
  }
  if (message.status === 'incomplete') {
    if (message.stopReason === 'max_tokens') {
      return 'This answer was cut off at the length limit. Ask a follow-up to continue.'
    }
    if (message.stopReason === 'aborted') return 'Stopped before the answer finished.'
  }
  return null
}

function Answer({
  message,
  onRetry
}: {
  message: Message
  /** Present only for a failed answer that can be asked again. */
  onRetry?: (() => void) | undefined
}) {
  const note = noteFor(message)
  const failed = message.status === 'failed'
  if (isPending(message)) {
    return (
      <article aria-label="Tutor answer" aria-busy="true">
        <Thinking />
      </article>
    )
  }
  return (
    <article aria-label="Tutor answer" className="flex flex-col gap-3">
      {message.content && (
        <div className={failed ? 'opacity-60' : ''}>
          <Markdown>{message.content}</Markdown>
        </div>
      )}
      {note && (
        <Note
          action={
            failed &&
            onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RetryIcon aria-hidden="true" className="size-4" />
                Retry
              </Button>
            )
          }
        >
          {note}
        </Note>
      )}
    </article>
  )
}

function Thinking() {
  return (
    <p className="flex items-center gap-2.5 text-ink-muted">
      <span
        aria-hidden="true"
        className="size-2.5 animate-pulse rounded-full border border-ink/25 bg-highlight"
      />
      Thinking…
    </p>
  )
}

type TranscriptProps = {
  messages: Message[]
  asking: Asking | undefined
  /** Ask the same question again. Undefined while asking is not possible. */
  onRetry?: ((question: string) => void) | undefined
}

/** Oldest first, notebook style: a ruled question, then the answer as prose on the sheet. */
export function Transcript({ messages, asking, onRetry }: TranscriptProps) {
  const saved = (id: string | undefined) => !!id && messages.some((m) => m.id === id)
  // The saved copy of the answer being streamed is an empty placeholder until the server
  // finishes: keep showing the streamed text until the real one replaces it.
  const placeholder = messages.find((m) => m.id === asking?.assistantMessageId && isPending(m))
  const showAskedQuestion = !!asking && !saved(asking.userMessageId)
  const showAskedAnswer = !!asking && (!saved(asking.assistantMessageId) || !!placeholder)
  const streaming = asking?.phase === 'thinking' || asking?.phase === 'streaming'

  return (
    <div className="flex flex-col gap-6">
      {messages.map((message, index) => {
        if (message === placeholder) return null
        if (message.role === 'user') {
          return (
            <Question
              key={message.id}
              content={message.content}
              dimmed={message.status === 'failed'}
            />
          )
        }
        const asked = messages[index - 1]
        const question = asked?.role === 'user' ? asked.content : undefined
        return (
          <Answer
            key={message.id}
            message={message}
            onRetry={onRetry && question ? () => onRetry(question) : undefined}
          />
        )
      })}
      {asking && showAskedQuestion && <Question content={asking.question} />}
      {asking && showAskedAnswer && (
        <article aria-label="Tutor answer" aria-busy={streaming} className="flex flex-col gap-3">
          {asking.text ? (
            <Markdown streaming={asking.phase === 'streaming'}>{asking.text}</Markdown>
          ) : asking.phase === 'thinking' ? (
            <Thinking />
          ) : null}
        </article>
      )}
    </div>
  )
}
