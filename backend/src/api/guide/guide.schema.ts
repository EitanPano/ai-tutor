import { z } from 'zod'

// Mirrors UpdateStepRequest in .orchestrate/api-contract.yaml: at least one property,
// `hintRevealed` can only be set to true.
export const updateStepSchema = z
  .strictObject({
    done: z.boolean().optional(),
    hintRevealed: z.literal(true).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })
