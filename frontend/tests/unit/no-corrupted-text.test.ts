import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd)
const roots = ['../../src', '../../../backend/src'].map((r) => path.resolve(import.meta.dirname, r))

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

describe('source text', () => {
  it('has no U+FFFD replacement characters (a sign of a mangled encoding)', () => {
    const corrupted = roots
      .flatMap((root) => [...walk(root)])
      .filter((file) => /\.(tsx?|mts|css|sql|json|md)$/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes(REPLACEMENT_CHARACTER))
      .map((file) => path.relative(path.resolve(import.meta.dirname, '../../..'), file))

    expect(corrupted).toEqual([])
  })
})
