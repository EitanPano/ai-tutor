// pg-pool has no error class or code for its timeouts; its messages are the only signal.
const POOL_CONNECT_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout'
]
// Socket errors that mean the connection could not be established. ECONNRESET is left out: a
// reset mid-request is not "cannot get a connection".
const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND'
])

// Errors seen failing a pool.connect() call. Codes alone are not DB-specific (an LLM fetch can
// also fail with ECONNREFUSED), so only an error raised at the pool boundary can qualify.
const fromPoolConnect = new WeakSet<object>()

/** Marks an error as raised by `pool.connect()`; see `isDbUnavailableError`. */
export function markPoolConnectError(err: unknown): void {
  if (typeof err === 'object' && err !== null) fromPoolConnect.add(err)
}

function isConnectFailure(err: unknown): boolean {
  if (err instanceof AggregateError) {
    return err.errors.length > 0 && err.errors.every(isConnectFailure)
  }
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && CONNECT_ERROR_CODES.has(code)) return true
  return POOL_CONNECT_MESSAGES.includes(err.message)
}

/**
 * True when the error means "could not get a database connection": it was raised by the pool's
 * connect (tagged by `createDb`) and is pg-pool's connect timeout or a socket-level connection
 * failure. A statement timeout (SQLSTATE 57014) is not one: the database answered, the query was
 * just too slow.
 */
export function isDbUnavailableError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && fromPoolConnect.has(err) && isConnectFailure(err)
  )
}
