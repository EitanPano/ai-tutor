import { messageFor } from '@/lib/api/error'
import type { Message } from '@/lib/api/thread'

/** The note under an answer that failed, or that the server never finished. */
export const FAILED_NOTE = 'This answer failed.'

type StopReason = NonNullable<Message['stopReason']>

/** One status's notes by stop reason; `fallback` covers any other reason, or none. */
type Notes = Partial<Record<StopReason, string>> & { fallback?: string }

/** A complete answer needs no note, so it has no entry. */
const NOTES_BY_STATUS: Partial<Record<Message['status'], Notes>> = {
  failed: { refusal: messageFor('ai_refused'), fallback: FAILED_NOTE },
  incomplete: {
    max_tokens: 'This answer was cut off at the length limit. Ask a follow-up to continue.',
    aborted: 'Stopped before the answer finished.'
  }
}

/** The note under a saved answer, by its status and then its stop reason; null when none. */
export function noteFor({
  status,
  stopReason
}: Pick<Message, 'status' | 'stopReason'>): string | null {
  const notes = NOTES_BY_STATUS[status]
  if (!notes) return null
  return (stopReason && notes[stopReason]) || notes.fallback || null
}
