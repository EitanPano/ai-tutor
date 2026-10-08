import { z } from 'zod'
import { pathSegment } from '../../lib/validation.js'

export const stepParams = z.object({ id: pathSegment(), stepId: pathSegment() })
export type StepParams = z.output<typeof stepParams>

// Mirrors UpdateStepRequest in .orchestrate/api-contract.yaml: at least one property,
// `hintRevealed` can only be set to true.
export const updateStepBody = z
  .strictObject({
    done: z.boolean().optional(),
    hintRevealed: z.literal(true).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })
export type UpdateStepBody = z.output<typeof updateStepBody>
