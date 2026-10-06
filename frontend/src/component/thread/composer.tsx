import { useId, type KeyboardEvent } from 'react'
import { Button } from '@/component/ui/button'
import { SendIcon, StopIcon } from '@/lib/icon'

export const COUNTER_FROM = 18_000
export const MAX_QUESTION = 20_000

type ComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** The composer cannot be used at all (budget spent, thread full). */
  disabled?: boolean
  /** An answer is arriving: Ask gives way to Stop. */
  streaming?: boolean
  onStop?: () => void
  /** The Ask button shows a spinner (the thread is being created). */
  submitting?: boolean
  autoFocus?: boolean
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  streaming = false,
  onStop,
  submitting = false,
  autoFocus = false
}: ComposerProps) {
  const id = useId()
  const counterId = `${id}-count`
  const length = value.length
  const tooLong = length > MAX_QUESTION
  const canSend = !disabled && !streaming && !submitting && !tooLong && value.trim().length > 0

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (canSend) onSubmit()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        Your question
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={3}
        placeholder="Paste code and ask what you want to understand"
        aria-describedby={length > COUNTER_FROM ? counterId : undefined}
        aria-invalid={tooLong || undefined}
        className={`field-sizing-content max-h-72 min-h-24 w-full resize-none rounded-md border bg-sheet px-3 py-2 font-sans text-base text-ink placeholder:text-ink-muted disabled:opacity-60 ${
          tooLong ? 'border-wrong' : 'border-rule hover:border-ink-muted'
        }`}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-ink-muted">
          Answers can be wrong. Don&apos;t paste secrets or personal data.
        </p>
        {length > COUNTER_FROM && (
          <p
            id={counterId}
            className={`text-sm tabular-nums ${tooLong ? 'font-semibold text-wrong' : 'text-ink-muted'}`}
          >
            {length.toLocaleString('en-US')} / {MAX_QUESTION.toLocaleString('en-US')}
            {tooLong && ' - too long to send'}
          </p>
        )}
        {streaming ? (
          <Button variant="secondary" onClick={onStop}>
            <StopIcon aria-hidden="true" className="size-4 fill-current" />
            Stop
          </Button>
        ) : (
          <Button onClick={onSubmit} disabled={!canSend} loading={submitting}>
            {!submitting && <SendIcon aria-hidden="true" className="size-4" />}
            Ask
          </Button>
        )}
      </div>
    </div>
  )
}
