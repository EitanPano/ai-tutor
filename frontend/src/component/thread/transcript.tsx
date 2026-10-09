import { memo, type ReactNode } from 'react'
import { Markdown } from '@/component/markdown/markdown'
import { Button } from '@/component/ui/button'
import { isPending, type Message } from '@/lib/api/thread'
import { RetryIcon } from '@/lib/icon'
import { FAILED_NOTE, noteFor } from './answer-note'
import type { Asking } from './use-ask'

/** A line that opens a code fence (three backticks or tildes): the author wrote Markdown. */
const hasCodeFence = (text: string) => /^ {0,3}(```|~~~)/m.test(text)

function Question({ content, isDimmed = false }: { content: string; isDimmed?: boolean }) {
  return (
    <article
      aria-label="Your question"
      className={`border-l-2 border-ink bg-ink/5 px-4 py-2 ${isDimmed ? 'opacity-60' : ''}`}
    >
      {/* Pasted code is not Markdown: `__init__`, `#include` and line breaks must survive. */}
      {hasCodeFence(content) ? (
        <Markdown className="prose-sm">{content}</Markdown>
      ) : (
        <p className="text-sm break-words whitespace-pre-wrap">{content}</p>
      )}
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

function Answer({
  message,
  isStalled,
  onRetry
}: {
  message: Message
  /** The server never finished this answer: show it as failed instead of waiting on it. */
  isStalled: boolean
  /** Present only for a failed answer that can be asked again. */
  onRetry?: (() => void) | undefined
}) {
  const isUnfinished = isPending(message)
  const note = isUnfinished && isStalled ? FAILED_NOTE : noteFor(message)
  const isFailed = message.status === 'failed' || (isUnfinished && isStalled)
  if (isUnfinished && !isStalled) {
    return (
      <article aria-label="Tutor answer" aria-busy="true">
        <Thinking />
      </article>
    )
  }
  return (
    <article aria-label="Tutor answer" className="flex flex-col gap-3">
      {message.content && (
        <div className={isFailed ? 'opacity-60' : ''}>
          <Markdown>{message.content}</Markdown>
        </div>
      )}
      {note && (
        <Note
          action={
            isFailed &&
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
  /** An unfinished answer has stopped changing for too long: treat it as failed. */
  isStalled?: boolean
  /** Ask the same question again. Undefined while asking is not possible. */
  onRetry?: ((question: string) => void) | undefined
}

/** Oldest first, notebook style: a ruled question, then the answer as prose on the sheet. */
export const Transcript = memo(function Transcript({
  messages,
  asking,
  isStalled = false,
  onRetry
}: TranscriptProps) {
  const isSaved = (id: string | undefined) => !!id && messages.some((m) => m.id === id)
  // The saved copy of the answer being streamed is an empty placeholder until the server
  // finishes: keep showing the streamed text until the real one replaces it.
  const placeholder = messages.find((m) => m.id === asking?.assistantMessageId && isPending(m))
  const shouldShowAskedQuestion = !!asking && !isSaved(asking.userMessageId)
  const shouldShowAskedAnswer = !!asking && (!isSaved(asking.assistantMessageId) || !!placeholder)
  const isStreaming = asking?.phase === 'thinking' || asking?.phase === 'streaming'

  return (
    <div className="flex flex-col gap-6">
      {messages.map((message, index) => {
        if (message === placeholder) return null
        if (message.role === 'user') {
          return (
            <Question
              key={message.id}
              content={message.content}
              isDimmed={message.status === 'failed'}
            />
          )
        }
        const asked = messages[index - 1]
        const question = asked?.role === 'user' ? asked.content : undefined
        return (
          <Answer
            key={message.id}
            message={message}
            isStalled={isStalled}
            onRetry={onRetry && question ? () => onRetry(question) : undefined}
          />
        )
      })}
      {asking && shouldShowAskedQuestion && <Question content={asking.question} />}
      {asking && shouldShowAskedAnswer && (
        <article aria-label="Tutor answer" aria-busy={isStreaming} className="flex flex-col gap-3">
          {asking.text ? (
            <Markdown isStreaming={asking.phase === 'streaming'}>{asking.text}</Markdown>
          ) : asking.phase === 'thinking' ? (
            <Thinking />
          ) : null}
        </article>
      )}
    </div>
  )
})
