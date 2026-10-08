// Plain values only: `proxy.ts` imports this module, so it must stay free of React and client code.

/** Where a signed-in user lands unless a page was asked for: from `/`, after sign-up or login. */
export const DEFAULT_PATH = '/thread'

/** Where a visitor without a session is sent: from `/`, a protected page, or after logging out. */
export const LOGIN_PATH = '/login'

/** The pages that need a session cookie: the proxy sends a visitor without one to /login. */
const PROTECTED_PREFIXES = ['/thread', '/guide', '/quiz', '/progress']

/** The pages that sign a visitor in. They expect a 401 from the session probe. */
const AUTH_PATHS = [LOGIN_PATH, '/signup']

/** True for `prefix` and any path below it: `/thread/abc` is under `/thread`, `/threads` is not. */
export const isPathUnder = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

export const isProtectedPath = (pathname: string) =>
  PROTECTED_PREFIXES.some((prefix) => isPathUnder(pathname, prefix))

export const isAuthPath = (pathname: string) =>
  AUTH_PATHS.some((path) => isPathUnder(pathname, path))
