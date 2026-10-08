import { Sheet } from '@/component/ui/sheet'
import type { ProgressResponse } from '@/lib/api/progress'
import { StreakIcon } from '@/lib/icon'

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

/** The page's one memorable element: the current streak, with the number on the marker swipe. */
export function Streak({ streak }: { streak: ProgressResponse['streak'] }) {
  const { current, longest, isActiveToday } = streak
  const isRunning = current > 0
  return (
    <Sheet as="section" aria-label="Streak" className="flex items-start gap-5 px-6 py-6 md:px-8">
      <StreakIcon
        aria-hidden="true"
        className={`mt-1 size-10 shrink-0 ${isRunning ? 'text-ink' : 'text-ink-muted'}`}
        strokeWidth={1.5}
      />
      <div className="flex min-w-0 flex-col gap-2">
        {isRunning ? (
          <p className="text-display font-extrabold tracking-tight">
            <span className="marker rounded-sm px-2">{current}</span> day streak
          </p>
        ) : (
          <p className="text-lead font-semibold">No streak yet. Ask a question to start one.</p>
        )}
        {longest > 0 && <p className="text-ink-muted">Longest: {days(longest)}</p>}
        {isRunning && (
          <p>
            {isActiveToday
              ? 'You studied today.'
              : 'Ask a question, finish a step or take a quiz today to keep it going.'}
          </p>
        )}
      </div>
    </Sheet>
  )
}
