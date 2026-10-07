// pg-pool has no error class or code for these; its messages are the only signal.
const POOL_CONNECT_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout'
]
const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND'
])

/**
 * True when the error means "could not get a database connection": pg-pool's connect timeout or
 * a socket-level connection failure. A statement timeout (SQLSTATE 57014) is not one: the
 * database answered, the query was just too slow.
 */
export function isDbUnavailableError(err: unknown): boolean {
  if (err instanceof AggregateError) {
    return err.errors.length > 0 && err.errors.every(isDbUnavailableError)
  }
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && CONNECT_ERROR_CODES.has(code)) return true
  return POOL_CONNECT_MESSAGES.includes(err.message)
}
