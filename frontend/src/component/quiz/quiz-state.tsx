import Link from 'next/link'
import { Button, buttonClass } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { isApiError } from '@/lib/api/error'
import { QuizIcon, RetryIcon } from '@/lib/icon'
import { describeQuizError } from './quiz-error'

export function QuizSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading quiz" className="flex flex-col gap-5">
      <div className="h-9 w-2/3 animate-pulse rounded-sm bg-rule" />
      <div className="h-96 animate-pulse rounded-md border border-rule bg-sheet" />
    </div>
  )
}

/** A quiz or attempt that did not load: gone (404) or a failure that may pass on retry. */
export function QuizMissing({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const missing = isApiError(error) && error.code === 'not_found'
  return (
    <Sheet>
      <EmptyState
        icon={missing ? QuizIcon : RetryIcon}
        action={
          missing ? (
            <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
              Back to threads
            </Link>
          ) : (
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )
        }
      >
        {describeQuizError(error)}
      </EmptyState>
    </Sheet>
  )
}
