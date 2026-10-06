export const DEFAULT_PATH = '/thread'

const BASE = 'http://local.invalid'
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Only same-site relative paths are allowed as a post-login target (no open redirect).
 * Parsed with the WHATWG URL parser, the same one the browser uses, so tabs, newlines and
 * backslashes cannot turn `/x` into a cross-origin target.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || CONTROL_CHARS.test(next)) return DEFAULT_PATH
  let url: URL
  try {
    url = new URL(next, BASE)
  } catch {
    return DEFAULT_PATH
  }
  if (url.origin !== BASE) return DEFAULT_PATH
  const result = url.pathname + url.search + url.hash
  // `//host` can survive as a pathname only if it was already `//`; refuse it outright.
  return result.startsWith('//') ? DEFAULT_PATH : result
}
