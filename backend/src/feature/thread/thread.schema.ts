import { z } from 'zod'
import { text } from '../../lib/validation.js'

// These schemas mirror ListThreads / CreateThreadRequest / UpdateThreadRequest in
// .orchestrate/api-contract.yaml.
export const listQuerySchema = z.object({
  cursor: text().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
})

export const createSchema = z.strictObject({
  topicId: text().min(1).optional(),
  title: text().trim().min(1).max(120).optional()
})

export const updateSchema = z
  .strictObject({
    title: text().trim().min(1).max(120).optional(),
    topicId: text().min(1).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })
