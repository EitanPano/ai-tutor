import { messageFor } from '@/lib/api/error'
import type { Message } from '@/lib/api/thread'

/** The note under an answer that failed, or that the server never finished. */
export const FAILED_NOTE = 'This answer failed.'

type StopReason = NonNullable<Message['stopReason']>

type NoteRule = {
  /** The note for a particular stop reason. */
  byReason: ReadonlyMap<StopReason, string>
  /** The note for any other stop reason, or none; null for no note. */
  fallback: string | null
}

// Maps, not objects: status and stop reason come off the wire and must never reach a prototype
// key. A complete answer needs no note, so it has no rule.
const NOTE_RULE_BY_STATUS: ReadonlyMap<Message['status'], NoteRule> = new Map([
  [
    'failed',
    {
      byReason: new Map<StopReason, string>([['refusal', messageFor('ai_refused')]]),
      fallback: FAILED_NOTE
    }
  ],
  [
    'incomplete',
    {
      byReason: new Map<StopReason, string>([
        ['max_tokens', 'This answer was cut off at the length limit. Ask a follow-up to continue.'],
        ['aborted', 'Stopped before the answer finished.']
      ]),
      fallback: null
    }
  ]
])

/** The note under a saved answer, by its status and then its stop reason; null when none. */
export function noteFor({
  status,
  stopReason
}: Pick<Message, 'status' | 'stopReason'>): string | null {
  const rule = NOTE_RULE_BY_STATUS.get(status)
  if (!rule) return null
  return (stopReason === null ? undefined : rule.byReason.get(stopReason)) ?? rule.fallback
}
