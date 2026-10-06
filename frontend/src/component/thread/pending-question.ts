/** The new-question page parks the first question here; the thread page asks it on mount. */
export const pendingQuestionKey = (threadId: string) => `pending-question:${threadId}`

/** Reads and removes the parked question, so a reload never asks twice. */
export function takePendingQuestion(threadId: string): string | null {
  try {
    const key = pendingQuestionKey(threadId)
    const question = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    return question
  } catch {
    return null
  }
}
