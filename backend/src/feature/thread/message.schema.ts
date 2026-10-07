import { z } from 'zod'
import { text } from '../../lib/validation.js'

// Mirrors AskRequest in .orchestrate/api-contract.yaml; whitespace-only counts as empty.
export const askSchema = z.strictObject({
  content: text()
    .max(20_000)
    .refine((value) => value.trim().length > 0, {
      message: 'Too small: expected at least 1 character'
    })
})
