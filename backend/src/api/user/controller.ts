import { ctxOf, servicesOf } from '../../context.js'
import { clearSessionCookie, setSessionCookie } from '../../lib/cookie.js'
import { unauthenticated } from '../../lib/error.js'
import { getAuth, readSessionToken } from '../../middleware/auth.js'
import type { Handler, ParamsDictionary } from '../../middleware/validate.js'
import type { LoginBody, SignUpBody, UpdateBody } from './validation.js'

/** Creates the user and their first session: 201 `{ user }` with the session cookie. */
export const signUp: Handler<ParamsDictionary, SignUpBody> = async (req, res) => {
  const { user, token } = await servicesOf(req).user.create(req.body)
  setSessionCookie(res, token, ctxOf(req).config)
  res.status(201).json({ user })
}

/** Changes the signed-in user's display name and/or time zone: `{ user }`. */
export const update: Handler<ParamsDictionary, UpdateBody> = async (req, res) => {
  const user = await servicesOf(req).user.update(getAuth(req), req.body)
  res.json({ user })
}

/** Verifies the credentials and rotates the request's session, if any: `{ user }` and a new cookie. */
export const logIn: Handler<ParamsDictionary, LoginBody> = async (req, res) => {
  const { user, token } = await servicesOf(req).session.login(
    req.body,
    readSessionToken(req.cookies)
  )
  setSessionCookie(res, token, ctxOf(req).config)
  res.json({ user })
}

/** The signed-in user: `{ user }`. */
export const me: Handler = async (req, res) => {
  const user = await servicesOf(req).user.get(getAuth(req))
  res.json({ user })
}

/** Ends the current session and clears its cookie: 204. */
export const logOut: Handler = async (req, res) => {
  const token = readSessionToken(req.cookies)
  // requireSession already ran; this also guards the route against being mounted without it.
  if (!token) throw unauthenticated()
  await servicesOf(req).session.logout(token)
  clearSessionCookie(res, ctxOf(req).config)
  res.status(204).end()
}
