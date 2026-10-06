import { createHash, randomBytes } from 'node:crypto'

/** 32 random bytes, base64url. Only the SHA-256 hash of this value is ever stored. */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
