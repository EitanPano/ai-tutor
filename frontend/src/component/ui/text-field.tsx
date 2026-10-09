import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  hint?: string
  error?: ReactNode
  id?: string
}

export function TextField({ label, hint, error, id: idProp, className, ...input }: TextFieldProps) {
  const generated = useId()
  const id = idProp ?? generated
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-10 rounded-md border bg-sheet px-3 text-base text-ink placeholder:text-ink-muted disabled:opacity-60',
          error ? 'border-wrong' : 'border-rule hover:border-ink-muted',
          className
        )}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-wrong">
          {error}
        </p>
      )}
    </div>
  )
}
