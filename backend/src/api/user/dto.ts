import type { AppUserRow } from '../../lib/db/schema.js'

export type UserDto = {
  id: string
  email: string
  displayName: string
  timeZone: string
  createdAt: string
}

/** Explicit mapping: the password hash must never leave the service layer. */
export function toUserDto(row: AppUserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    timeZone: row.time_zone,
    createdAt: row.created_at.toISOString()
  }
}
