import Link from 'next/link'
import { buttonClass } from '@/component/ui/button'
import { ErrorPanel } from '@/component/ui/error-panel'
import { isApiError } from '@/lib/api/error'
import { QuizIcon } from '@/lib/icon'
import { describeQuizError } from './quiz-error'

/** A quiz or attempt that did not load: gone (404) or a failure that may pass on retry. */
export function QuizMissing({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const missing = isApiError(error) && error.code === 'not_found'
  return missing ? (
    <ErrorPanel
      icon={QuizIcon}
      action={
        <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
          Back to threads
        </Link>
      }
    >
      {describeQuizError(error)}
    </ErrorPanel>
  ) : (
    <ErrorPanel onRetry={onRetry}>{describeQuizError(error)}</ErrorPanel>
  )
}
