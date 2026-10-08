import { Router } from 'express'
import { requireSession } from '../../middleware/auth.js'
import { rateLimitByIp, rateLimitByIpAndEmail } from '../../middleware/rate-limit.js'
import { validate } from '../../middleware/validate.js'
import { logIn, logOut, me, signUp, update } from './controller.js'
import { loginBody, signUpBody, updateBody } from './validation.js'

const router = Router()

const signUpLimiter = rateLimitByIp(
  'signup',
  'Too many sign-ups from this address. Try again later.'
)
const loginIpLimiter = rateLimitByIp('loginIp', 'Too many login attempts. Try again shortly.')
const loginLimiter = rateLimitByIpAndEmail('login', 'Too many login attempts. Try again shortly.')

const validateSignUp = validate({ body: signUpBody })
const validateUpdate = validate({ body: updateBody })
const validateLogin = validate({ body: loginBody })

// The sign-up limiter first, before parsing, hashing or any database work: every sign-up costs an
// argon2id hash.
router.post('/api/user', signUpLimiter, validateSignUp, signUp)
router.patch('/api/user', requireSession, validateUpdate, update)
// The per-IP limit first, so a flood of fresh emails never reaches the argon2 verify. The ip + email
// limit reads the parsed email, so it runs after validateLogin.
router.post('/api/session', validateLogin, loginIpLimiter, loginLimiter, logIn)
router.get('/api/session', requireSession, me)
router.delete('/api/session', requireSession, logOut)

export default router
