import type { ProgressResponse } from '@/lib/api/progress'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One quiet sentence, not a row of stat tiles. */
export function Totals({ totals }: { totals: ProgressResponse['totals'] }) {
  const { questions, stepsDone, guidesCompleted, attempts } = totals
  return (
    <p className="text-ink-muted">
      {count(questions, 'question', 'questions')} asked, {count(stepsDone, 'step', 'steps')} done,{' '}
      {count(guidesCompleted, 'guide', 'guides')} completed,{' '}
      {count(attempts, 'quiz attempt', 'quiz attempts')}
    </p>
  )
}
