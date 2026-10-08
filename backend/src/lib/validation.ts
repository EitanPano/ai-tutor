import { z } from 'zod'

/** Postgres `text` cannot hold U+0000 (22021), which would surface as a 500. */
export const hasNoNul = (value: string): boolean => !value.includes('\u0000')
const NUL_ISSUE = { message: 'Must not contain NUL characters.' }

/** A Zod string that rejects U+0000. Use it for every text input in `src/api/`. */
export const text = () => z.string().refine(hasNoNul, NUL_ISSUE)

/** A Zod email that rejects U+0000. */
export const email = () => z.email().refine(hasNoNul, NUL_ISSUE)

/** A path segment as a string; non-strings and values holding U+0000 become `''` (a 404 lookup). */
export function pathParam(value: unknown): string {
  return typeof value === 'string' && hasNoNul(value) ? value : ''
}

/**
 * A Zod path segment; a value holding U+0000 becomes `''`, so the lookup answers 404 rather than
 * 400 (a NUL can never name a row).
 */
export const pathSegment = () => z.string().transform((value) => (hasNoNul(value) ? value : ''))
