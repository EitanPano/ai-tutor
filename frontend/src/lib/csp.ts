/**
 * Content-Security-Policy for a page response. `proxy.ts` calls it once per request with a fresh
 * nonce; Next reads the nonce back out of the header and stamps it on its own scripts.
 *
 * - `'strict-dynamic'` lets the nonced bootstrap script load the rest of the bundle.
 * - `'unsafe-eval'` is development only: React's dev tooling needs it, production does not.
 * - `style-src 'unsafe-inline'`: Next, next/font and Shiki's token markup emit inline styles.
 *   Style injection can't run script, so this is the accepted trade for the MVP.
 */
export function buildCsp({
  nonce,
  apiUrl,
  isDev
}: {
  nonce: string
  apiUrl: string
  isDev: boolean
}): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${new URL(apiUrl).origin}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`
  ]
  return directives.join('; ')
}

export function newNonce(): string {
  return btoa(crypto.randomUUID())
}
