import { z } from 'zod'
import { email, text } from '../../lib/validation.js'

// These schemas mirror SignupRequest / UpdateUserRequest in .orchestrate/api-contract.yaml.
export const signupSchema = z.strictObject({
  email: email().max(254),
  password: text().min(8).max(128),
  displayName: text().trim().min(1).max(80),
  timeZone: text().min(1).max(64)
})

export const updateSchema = z
  .strictObject({
    displayName: text().trim().min(1).max(80).optional(),
    timeZone: text().min(1).max(64).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })
