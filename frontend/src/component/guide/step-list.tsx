import { memo } from 'react'
import type { Step } from '@/lib/api/guide'
import { DoneIcon } from '@/lib/icon'

type StepListProps = {
  steps: Step[]
  /** The id of the step being read, if any (not on the completion state). */
  currentId: string | undefined
  onSelect: (stepId: string) => void
}

/** The whole sequence at a glance, from lg up. Numbers are right here: steps are ordered. */
export const StepList = memo(function StepList({ steps, currentId, onSelect }: StepListProps) {
  return (
    <nav aria-label="Steps" className="hidden lg:sticky lg:top-10 lg:block">
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => {
          const current = step.id === currentId
          const done = !!step.doneAt
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-current={current ? 'step' : undefined}
                className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                  current ? 'border-ink bg-sheet' : 'border-transparent hover:bg-ink/10'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums ${
                    done ? 'border-correct bg-correct text-sheet' : 'border-ink-muted text-ink'
                  }`}
                >
                  {done ? <DoneIcon className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                <span className={`min-w-0 break-words ${current ? 'font-semibold' : ''}`}>
                  <span className="sr-only">Step {index + 1}:</span> {step.title}
                  {done && (
                    <>
                      {' '}
                      <span className="sr-only">(done)</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
})
