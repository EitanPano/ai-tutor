// AC12: no secret material may ship in the frontend build. Scans every file under
// frontend/.next for provider-key markers. It never reads any environment file.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../frontend/.next', import.meta.url))
const MARKERS = ['sk-ant', 'ANTHROPIC']

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

let scanned = 0
const offenders = []
try {
  for (const file of walk(root)) {
    scanned += 1
    const text = readFileSync(file, 'latin1')
    if (MARKERS.some((marker) => text.includes(marker))) offenders.push(file)
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('frontend/.next not found: run "bun run --filter frontend build" first')
    process.exit(1)
  }
  throw err
}

if (offenders.length > 0) {
  console.error('Secret markers found in the frontend build:')
  for (const file of offenders) console.error(`  ${file}`)
  process.exit(1)
}
console.log(`OK: no secret markers in ${scanned} files under frontend/.next`)
