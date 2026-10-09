import { memo } from 'react'

/**
 * One segment per step, filled in ink left to right on the `--rule` track. Segments rather than a
 * sized fill: a step count is discrete, and it needs no inline width.
 */
export const ProgressBar = memo(function ProgressBar({
  doneCount,
  total
}: {
  doneCount: number
  total: number
}) {
  const label = `${doneCount} of ${total} steps done`
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={doneCount}
        aria-valuetext={label}
        className="flex h-2 min-w-0 flex-1 gap-0.5"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`flex-1 transition-colors first:rounded-l-sm last:rounded-r-sm ${i < doneCount ? 'bg-ink' : 'bg-rule'}`}
          />
        ))}
      </div>
      <p aria-hidden="true" className="shrink-0 text-sm font-semibold tabular-nums text-ink-muted">
        {doneCount} / {total}
      </p>
    </div>
  )
})
