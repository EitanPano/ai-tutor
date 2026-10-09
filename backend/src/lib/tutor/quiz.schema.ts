import { z } from 'zod'

/**
 * The quiz the model must produce. The API may not enforce every length, count or uniqueness
 * constraint of a structured-output schema, so the service re-validates the output with this
 * same schema. The distinct-choices refinement only exists here: it is not part of the JSON
 * schema sent to the API.
 */
const QuizItemDraftSchema = z
  .object({
    prompt: z.string().min(1).max(1000),
    choices: z.array(z.string().min(1).max(300)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    /** Why the right answer is right and the others are wrong. */
    explanation: z.string().min(1).max(1500)
  })
  .refine((item) => new Set(item.choices.map((choice) => choice.trim().toLowerCase())).size === 4, {
    message: 'The four choices must be distinct.',
    path: ['choices']
  })

export const QuizDraftSchema = z.object({
  items: z.array(QuizItemDraftSchema).length(5)
})

export type QuizDraft = z.infer<typeof QuizDraftSchema>
