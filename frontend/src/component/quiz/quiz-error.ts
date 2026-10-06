import { describeError, isApiError } from '@/lib/api/error'

/** The sentence for a failed quiz request. A missing quiz is named as one, not as a thread. */
export function describeQuizError(err: unknown): string {
  return isApiError(err) && err.code === 'not_found'
    ? "This quiz doesn't exist or was deleted."
    : describeError(err)
}
