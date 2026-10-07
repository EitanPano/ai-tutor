'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { FormError } from '@/component/ui/form-error'
import { Select } from '@/component/ui/select'
import { Sheet } from '@/component/ui/sheet'
import { TextField } from '@/component/ui/text-field'
import { describeError, fieldIssues, isApiError } from '@/lib/api/error'
import { progressKey } from '@/lib/api/progress'
import { updateUser } from '@/lib/api/user'
import { SESSION_KEY } from '@/lib/session'
import type { components } from '@/types/api'

type User = components['schemas']['User']
type UpdateUserRequest = components['schemas']['UpdateUserRequest']

/** Every IANA zone the browser knows, plus the stored one in case the browser does not list it. */
function timeZones(current: string) {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    // An older engine: the stored zone alone still lets the form render.
  }
  return zones.includes(current) ? zones : [current, ...zones]
}

const memberSince = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

export function ProfileForm({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [timeZone, setTimeZone] = useState(user.timeZone)
  const [saved, setSaved] = useState(false)
  const zones = useMemo(() => timeZones(user.timeZone), [user.timeZone])

  const trimmed = displayName.trim()
  const changes: UpdateUserRequest = {
    ...(trimmed !== user.displayName && { displayName: trimmed }),
    ...(timeZone !== user.timeZone && { timeZone })
  }
  const changed = Object.keys(changes).length > 0

  const save = useMutation({
    mutationFn: (input: UpdateUserRequest) => updateUser(input),
    onSuccess: async ({ user: next }) => {
      queryClient.setQueryData(SESSION_KEY, { user: next })
      setDisplayName(next.displayName)
      setTimeZone(next.timeZone)
      setSaved(true)
      toast.success('Profile saved')
      // The day boundary, and so the streak, follows the time zone.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
        queryClient.invalidateQueries({ queryKey: progressKey })
      ])
    }
  })

  const issues = fieldIssues(save.error)
  // The once-a-day limit is about the time zone field, though it is not a validation failure.
  if (isApiError(save.error) && save.error.code === 'time_zone_recently_changed') {
    issues.timeZone = describeError(save.error)
  }
  const formError =
    save.isError && Object.keys(issues).length === 0 ? describeError(save.error) : ''

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!changed || save.isPending) return
    setSaved(false)
    save.mutate(changes)
  }

  return (
    <section aria-labelledby="profile-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="profile-heading" className="text-lead">
        Profile
      </h2>
      <Sheet>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-5">
          <TextField
            label="Display name"
            value={displayName}
            autoComplete="name"
            error={issues.displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              setSaved(false)
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Select
              label="Time zone"
              value={timeZone}
              aria-describedby={
                issues.timeZone ? 'time-zone-hint time-zone-error' : 'time-zone-hint'
              }
              aria-invalid={issues.timeZone ? true : undefined}
              onChange={(e) => {
                setTimeZone(e.target.value)
                setSaved(false)
              }}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
            <p id="time-zone-hint" className="text-sm text-ink-muted">
              Your streak counts days in this time zone.
            </p>
            {issues.timeZone && (
              <p id="time-zone-error" className="text-sm text-wrong">
                {issues.timeZone}
              </p>
            )}
          </div>
          <p className="text-sm text-ink-muted">Member since {memberSince(user.createdAt)}</p>
          <FormError>{formError}</FormError>
          <div className="flex items-center gap-3">
            {/* aria-disabled, not disabled: a disabled button would drop keyboard focus to the page. */}
            <Button
              type="submit"
              aria-disabled={!changed || save.isPending}
              aria-busy={save.isPending || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {save.isPending ? 'Saving…' : 'Save profile'}
            </Button>
            <p role="status" className="text-sm text-correct">
              {saved && !changed ? 'Saved.' : ''}
            </p>
          </div>
        </form>
      </Sheet>
    </section>
  )
}
