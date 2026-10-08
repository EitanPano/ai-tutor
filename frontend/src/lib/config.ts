// Plain values only: `proxy.ts` imports this module, so it must stay free of React and client code.

/** The backend origin. `NEXT_PUBLIC_` values are inlined at build time, proxy and browser alike. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/** The session cookie the API sets. The proxy and the auth layout only check that it is there. */
export const SESSION_COOKIE = 'sid'
