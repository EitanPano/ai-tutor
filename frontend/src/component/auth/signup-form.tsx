'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { Sheet } from '@/component/ui/sheet'
import { TextField } from '@/component/ui/text-field'
import { describeError, fieldIssues, isApiError } from '@/lib/api/error'
import { signUp } from '@/lib/api/user'
import { DEFAULT_PATH } from '@/lib/route'
import { SESSION_KEY } from '@/lib/session'

const FALLBACK_TIME_ZONE = 'UTC'
const noSubscription = () => () => {}
const detectTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE

export function SignupForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // The browser's zone on the client, a fixed fallback during server render and hydration.
  const timeZone = useSyncExternalStore(noSubscription, detectTimeZone, () => FALLBACK_TIME_ZONE)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [emailTaken, setEmailTaken] = useState(false)

  const signup = useMutation({
    mutationFn: signUp,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY, refetchType: 'all' })
      router.replace(DEFAULT_PATH)
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'email_taken') {
        setEmailTaken(true)
      } else if (isApiError(err) && err.code === 'validation_failed') {
        setIssues(fieldIssues(err))
      } else {
        toast.error(describeError(err))
      }
    }
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailTaken(false)
    const nextIssues: Record<string, string> = {}
    if (!displayName.trim()) nextIssues.displayName = 'Enter your name.'
    if (!email.trim()) nextIssues.email = 'Enter your email.'
    if (password.length < 8) nextIssues.password = 'Use at least 8 characters.'
    setIssues(nextIssues)
    if (Object.keys(nextIssues).length > 0) return
    signup.mutate({ displayName: displayName.trim(), email: email.trim(), password, timeZone })
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
        <Button type="submit" size="lg" loading={signup.isPending} className="mt-2">
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
