import argon2 from 'argon2'

// OWASP argon2id minimum: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS)
}

/** Returns false for a wrong password or an unparseable hash; never throws on bad input. */
export async function isPasswordCorrect(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
