import { useId, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string
  /** Hide the label visually when the surrounding layout already names the control. */
  isLabelHidden?: boolean
  id?: string
}

/** A native `<select>` in the notebook tokens: keyboard and mobile pickers come for free. */
export function Select({
  label,
  isLabelHidden = false,
  id: idProp,
  className,
  children,
  ...rest
}: SelectProps) {
  const generated = useId()
  const id = idProp ?? generated
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={isLabelHidden ? 'sr-only' : 'text-sm font-semibold'}>
        {label}
      </label>
      <select
        id={id}
        className={cn(
          'h-10 rounded-md border border-rule bg-sheet px-3 text-base text-ink hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-60',
          className
        )}
        {...rest}
      >
        {children}
      </select>
    </div>
  )
}
