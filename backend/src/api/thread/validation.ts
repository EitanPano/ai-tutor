import { z } from 'zod'
import { atLeastOneField, id, text, title } from '../../lib/validation.js'

// These schemas mirror ListThreads / CreateThreadRequest / UpdateThreadRequest / AskRequest in
// .orchestrate/api-contract.yaml.
export const listQuery = z.object({
  cursor: text().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
})
export type ListQuery = z.output<typeof listQuery>

export const createBody = z.strictObject({
  topicId: id().optional(),
  title: title().optional()
})
export type CreateBody = z.output<typeof createBody>

export const updateBody = atLeastOneField(
  z.strictObject({
    title: title().optional(),
    topicId: id().optional()
  })
)
export type UpdateBody = z.output<typeof updateBody>

// Whitespace-only counts as empty.
export const askBody = z.strictObject({
  content: text()
    .max(20_000)
    .refine((value) => value.trim().length > 0, {
      message: 'Too small: expected at least 1 character'
    })
})
export type AskBody = z.output<typeof askBody>
