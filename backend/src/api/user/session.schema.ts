import { z } from 'zod'
import { email, text } from '../../lib/validation.js'

// Mirrors LoginRequest in .orchestrate/api-contract.yaml.
export const loginSchema = z.strictObject({
  email: email().max(254),
  password: text().min(1).max(128)
})
