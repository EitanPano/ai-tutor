import { z } from 'zod'
import { pathSegment, text } from '../../lib/validation.js'

const difficulty = z.enum(['easy', 'medium', 'hard'])

// Mirrors CreateQuizRequest in .orchestrate/api-contract.yaml: exactly one of `threadId`
// (optional difficulty) or `topicId` (difficulty required).
export const createBody = z.union([
  z.strictObject({ threadId: text().min(1), difficulty: difficulty.optional() }),
  z.strictObject({ topicId: text().min(1), difficulty })
])
export type CreateBody = z.output<typeof createBody>

// Mirrors SubmitAttemptRequest. The service checks the ids against the quiz.
export const submitAttemptBody = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        itemId: text().min(1),
        choiceIndex: z.number().int().min(0).max(3)
      })
    )
    .max(5)
})
export type SubmitAttemptBody = z.output<typeof submitAttemptBody>

export const attemptParams = z.object({ id: pathSegment(), attemptId: pathSegment() })
export type AttemptParams = z.output<typeof attemptParams>
