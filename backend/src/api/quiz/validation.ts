import { z } from 'zod'
import { id, pathSegment } from '../../lib/validation.js'

const difficulty = z.enum(['easy', 'medium', 'hard'])

// Mirrors CreateQuizRequest in .orchestrate/api-contract.yaml: exactly one of `threadId`
// (optional difficulty) or `topicId` (difficulty required).
export const createBody = z.union([
  z.strictObject({ threadId: id(), difficulty: difficulty.optional() }),
  z.strictObject({ topicId: id(), difficulty })
])
export type CreateBody = z.output<typeof createBody>

// Mirrors SubmitAttemptRequest. The service checks the ids against the quiz.
export const submitAttemptBody = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        itemId: id(),
        choiceIndex: z.number().int().min(0).max(3)
      })
    )
    .max(5)
})
export type SubmitAttemptBody = z.output<typeof submitAttemptBody>

export const attemptParams = z.object({ id: pathSegment(), attemptId: pathSegment() })
export type AttemptParams = z.output<typeof attemptParams>
