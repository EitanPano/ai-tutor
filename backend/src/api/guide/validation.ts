import { z } from 'zod'
import { atLeastOneField, pathSegment } from '../../lib/validation.js'

export const stepParams = z.object({ id: pathSegment(), stepId: pathSegment() })
export type StepParams = z.output<typeof stepParams>

// Mirrors UpdateStepRequest in .orchestrate/api-contract.yaml: at least one property,
// `isHintRevealed` can only be set to true.
export const updateStepBody = atLeastOneField(
  z.strictObject({
    isDone: z.boolean().optional(),
    isHintRevealed: z.literal(true).optional()
  })
)
export type UpdateStepBody = z.output<typeof updateStepBody>
