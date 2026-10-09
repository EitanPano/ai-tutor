import { z } from 'zod'
import { atLeastOneField, displayName, emailAddress, text, timeZone } from '../../lib/validation.js'

// Mirrors SignupRequest in .orchestrate/api-contract.yaml.
export const signUpBody = z.strictObject({
  email: emailAddress(),
  password: text().min(8).max(128),
  displayName: displayName(),
  timeZone: timeZone()
})
export type SignUpBody = z.output<typeof signUpBody>

// Mirrors UpdateUserRequest in .orchestrate/api-contract.yaml.
export const updateBody = atLeastOneField(
  z.strictObject({
    displayName: displayName().optional(),
    timeZone: timeZone().optional()
  })
)
export type UpdateBody = z.output<typeof updateBody>

// Mirrors LoginRequest in .orchestrate/api-contract.yaml.
export const loginBody = z.strictObject({
  email: emailAddress(),
  password: text().min(1).max(128)
})
export type LoginBody = z.output<typeof loginBody>
