import { z } from 'zod'

/** Postgres `text` cannot hold U+0000 (22021), which would surface as a 500. */
export const hasNoNul = (value: string): boolean => !value.includes('\u0000')
const NUL_ISSUE = { message: 'Must not contain NUL characters.' }

/** A Zod string that rejects U+0000. Use it for every text input in `src/api/`. */
export const text = () => z.string().refine(hasNoNul, NUL_ISSUE)

/** A Zod email that rejects U+0000. Schemas use `emailAddress`, which also caps the length. */
const email = () => z.email().refine(hasNoNul, NUL_ISSUE)

// Fields that more than one schema in `src/api/` accepts. Their limits and messages are part of
// the API contract (.orchestrate/api-contract.yaml), so they are defined once.

/** A thread title. */
export const title = () => text().trim().min(1).max(120)

/** A user's display name. */
export const displayName = () => text().trim().min(1).max(80)

/** A time zone as the client sends it; the user service checks it names a real IANA zone. */
export const timeZone = () => text().min(1).max(64)

/** An account email: 254 characters is the longest address SMTP can deliver to. */
export const emailAddress = () => email().max(254)

/** An id sent in a body or query string (a path id is a `pathSegment`). */
export const id = () => text().min(1)

/** Refuses an empty object, for a body whose every field is optional. */
export function atLeastOneField<S extends z.ZodObject>(schema: S): S {
  return schema.refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field.'
  })
}

/**
 * A Zod path segment; a value holding U+0000 becomes `''`, so the lookup answers 404 rather than
 * 400 (a NUL can never name a row).
 */
export const pathSegment = () => z.string().transform((value) => (hasNoNul(value) ? value : ''))

/** The `:id` path segment of a route; shared by every route keyed by one id. */
export const idParams = z.object({ id: pathSegment() })
export type IdParams = z.output<typeof idParams>
