export const DEFAULT_PATH = '/thread'

/** Only same-site relative paths are allowed as a post-login target (no open redirect). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return DEFAULT_PATH
  }
  return next
}
