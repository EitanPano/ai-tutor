'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { Button } from '@/component/ui/button'
import { Sheet } from '@/component/ui/sheet'
import { TextField } from '@/component/ui/text-field'
import { signUp } from '@/lib/api/user'
import { DEFAULT_PATH } from '@/lib/route'
import { useAuthForm, type FieldIssues } from './use-auth-form'

const FALLBACK_TIME_ZONE = 'UTC'
const noSubscription = () => () => {}
const detectTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE

export function SignupForm() {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // The browser's zone on the client, a fixed fallback during server render and hydration.
  const timeZone = useSyncExternalStore(noSubscription, detectTimeZone, () => FALLBACK_TIME_ZONE)
  const [emailTaken, setEmailTaken] = useState(false)
  const { issues, isPending, submit } = useAuthForm({
    send: signUp,
    nextPath: DEFAULT_PATH,
    onErrorCode: { email_taken: () => setEmailTaken(true) }
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailTaken(false)
    const checks: FieldIssues = {}
    if (!displayName.trim()) checks.displayName = 'Enter your name.'
    if (!email.trim()) checks.email = 'Enter your email.'
    if (password.length < 8) checks.password = 'Use at least 8 characters.'
    submit(checks, { displayName: displayName.trim(), email: email.trim(), password, timeZone })
  }

  return (
    <Sheet as="section" className="flex flex-col gap-6 p-6 sm:p-8" aria-labelledby="signup-title">
      <h1 id="signup-title" className="text-title">
        Create account
      </h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Display name"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={issues.displayName}
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={
            emailTaken ? (
              <>
                An account with this email already exists.{' '}
                <Link href="/login" className="font-semibold underline underline-offset-2">
                  Log in
                </Link>
              </>
            ) : (
              issues.email
            )
          }
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={issues.password}
        />
        <p className="text-sm text-ink-muted">
          Time zone: {timeZone} — you can change it later on Progress
        </p>
        {issues.timeZone && (
          <p role="alert" className="text-sm text-wrong">
            The server did not accept the time zone {timeZone}: {issues.timeZone}
          </p>
        )}
        <Button type="submit" size="lg" loading={isPending} className="mt-2">
          Create account
        </Button>
      </form>
      <p className="text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold underline underline-offset-2">
          Log in
        </Link>
      </p>
    </Sheet>
  )
}
