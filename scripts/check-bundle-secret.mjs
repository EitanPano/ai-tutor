// AC12: no secret material may ship in the frontend build. Scans the client output
// (<dist>/static, what browsers download) of a production build for provider-key markers.
// CI builds with canary key values (ci.yml), so a client reference to a key is inlined
// and found here. It never reads any environment file.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = fileURLToPath(new URL('../frontend', import.meta.url))
const distName = process.env.NEXT_DIST_DIR ?? '.next'
const dist = join(frontendDir, distName)
const MARKERS = ['sk-ant', 'ANTHROPIC']

function fail(message) {
  console.error(message)
  process.exit(1)
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

// `next dev` also creates the dist dir (.next/dev), so only BUILD_ID proves a production build.
if (!existsSync(join(dist, 'BUILD_ID'))) {
  fail(`no production build in frontend/${distName}: run "bun run --filter frontend build" first`)
}
const clientDir = join(dist, 'static')
if (!existsSync(clientDir)) fail(`frontend/${distName}/static not found: the build is incomplete`)

let scanned = 0
const offenders = []
for (const file of walk(clientDir)) {
  scanned += 1
  const text = readFileSync(file, 'latin1')
  if (MARKERS.some((marker) => text.includes(marker))) offenders.push(file)
}

if (offenders.length > 0) {
  console.error('Secret markers found in the frontend client build:')
  for (const file of offenders) console.error(`  ${relative(frontendDir, file)}`)
  process.exit(1)
}
console.log(`OK: no secret markers in ${scanned} client files under frontend/${distName}/static`)
