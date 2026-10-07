import { sql } from 'kysely'
import type { Db } from './db/index.js'

/**
 * Names V8 (`Intl`) still emits but Postgres 18 rejects, mapped to the current tzdata name.
 * Migration `007-normalise-time-zone.sql` carries the same table: keep both in sync (a test
 * enforces it).
 */
export const LEGACY_TIME_ZONE: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk'
}

const LEGACY_BY_LOWER = new Map(
  Object.entries(LEGACY_TIME_ZONE).map(([legacy, current]) => [legacy.toLowerCase(), current])
)

/** Area/Location-like (or a bare name such as `UTC`): rejects `+01:00`, `-5`, `GMT+1` style offsets. */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

function isKnownToIntl(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

async function findPostgresName(db: Db, name: string): Promise<string | null> {
  const { rows } = await sql<{ name: string }>`
    SELECT name FROM pg_timezone_names WHERE lower(name) = lower(${name}) LIMIT 1`.execute(db)
  return rows[0]?.name ?? null
}

/**
 * Returns Postgres's spelling of `input`, or `null` when it is not a usable IANA zone. Legacy
 * aliases that V8 emits (`Asia/Calcutta`) are mapped to the current name. Offset-style ids are
 * rejected: Postgres reads `+01:00` with the opposite (POSIX) sign to ISO 8601.
 */
export async function normaliseTimeZone(db: Db, input: string): Promise<string | null> {
  if (!ZONE_NAME.test(input) || !isKnownToIntl(input)) return null
  const direct = await findPostgresName(db, input)
  if (direct !== null) return direct
  const modern = LEGACY_BY_LOWER.get(input.toLowerCase())
  return modern === undefined ? null : findPostgresName(db, modern)
}
