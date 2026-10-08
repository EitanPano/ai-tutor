import { z } from 'zod'
import { email, text } from '../../lib/validation.js'

// Mirrors SignupRequest in .orchestrate/api-contract.yaml.
export const signUpBody = z.strictObject({
  email: email().max(254),
  password: text().min(8).max(128),
  displayName: text().trim().min(1).max(80),
  timeZone: text().min(1).max(64)
})
export type SignUpBody = z.output<typeof signUpBody>

// Mirrors UpdateUserRequest in .orchestrate/api-contract.yaml.
export const updateBody = z
  .strictObject({
    displayName: text().trim().min(1).max(80).optional(),
    timeZone: text().min(1).max(64).optional()
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' })
export type UpdateBody = z.output<typeof updateBody>

// Mirrors LoginRequest in .orchestrate/api-contract.yaml.
export const loginBody = z.strictObject({
  email: email().max(254),
  password: text().min(1).max(128)
})
export type LoginBody = z.output<typeof loginBody>
