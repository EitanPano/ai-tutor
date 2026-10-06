import { useEffect, useId, useRef } from 'react'
import { CodeBlock } from '@/component/markdown/code-block'
import { Markdown } from '@/component/markdown/markdown'
import { Button } from '@/component/ui/button'
import { Sheet } from '@/component/ui/sheet'
import type { Step } from '@/lib/api/guide'
import { BackIcon, DoneIcon, HintIcon, NextIcon } from '@/lib/icon'

type StepPanelProps = {
  step: Step
  /** Zero-based position in the guide. */
  index: number
  total: number
  /** Move focus to the title on mount: the step changed because the reader asked it to. */
  focusTitle: boolean
  onRevealHint: (stepId: string) => void
  onToggleDone: (stepId: string, done: boolean) => void
  onPrevious: () => void
  onNext: () => void
}

/**
 * The focused step. The parent keys it by step id, so moving to another step remounts it: focus,
 * the hint's focus request and scroll all start fresh.
 */
export function StepPanel({
  step,
  index,
  total,
  focusTitle,
  onRevealHint,
  onToggleDone,
  onPrevious,
  onNext
}: StepPanelProps) {
  const titleId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const hint = useRef<HTMLElement>(null)
  // Set by the Show hint click: the button is replaced by the hint, so focus follows it.
  const hintAsked = useRef(false)
  const done = !!step.doneAt
  const revealed = !!step.hintRevealedAt

  useEffect(() => {
    if (focusTitle) title.current?.focus()
  }, [focusTitle])

  useEffect(() => {
    if (revealed && hintAsked.current) {
      hintAsked.current = false
      hint.current?.focus()
    }
  }, [revealed])

  return (
    <Sheet as="article" aria-labelledby={titleId} className="flex flex-col gap-6 p-5 md:p-8">
      <header className="flex flex-col gap-3">
        <p className="flex items-center gap-3 text-sm font-semibold text-ink-muted">
          <span>
            Step {index + 1} of {total}
          </span>
          {done && (
            <span className="inline-flex items-center gap-1 text-correct">
              <DoneIcon aria-hidden="true" className="size-4" strokeWidth={3} />
              Done
            </span>
          )}
        </p>
        <h2 id={titleId} ref={title} tabIndex={-1} className="text-title leading-snug">
          <span className="marker rounded-sm px-1">{step.title}</span>
        </h2>
      </header>

      <Markdown className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{step.body}</Markdown>
      {step.code && (
        <div className="max-w-[72ch]">
          <CodeBlock code={step.code} {...(step.codeLanguage && { language: step.codeLanguage })} />
        </div>
      )}

      {revealed && (
        <aside
          ref={hint}
          tabIndex={-1}
          aria-label="Hint"
          className="flex max-w-[72ch] gap-3 rounded-md border border-rule bg-ink/5 px-4 py-3"
        >
          <HintIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-muted" />
          <Markdown className="prose-sm min-w-0 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
            {step.hint}
          </Markdown>
        </aside>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!revealed && (
          <Button
            variant="secondary"
            onClick={() => {
              hintAsked.current = true
              onRevealHint(step.id)
            }}
          >
            <HintIcon aria-hidden="true" className="size-4" />
            Show hint
          </Button>
        )}
        <Button
          variant={done ? 'secondary' : 'primary'}
          onClick={() => onToggleDone(step.id, !done)}
        >
          {done ? 'Mark not done' : 'Mark done'}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-rule pt-4">
        <Button variant="ghost" onClick={onPrevious} disabled={index === 0}>
          <BackIcon aria-hidden="true" className="size-4" />
          Previous
        </Button>
        <Button variant="ghost" onClick={onNext} disabled={index === total - 1}>
          Next
          <NextIcon aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </Sheet>
  )
}
