'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { Button } from '@/component/ui/button'
import { FormError } from '@/component/ui/form-error'
import { Sheet } from '@/component/ui/sheet'
import { TextField } from '@/component/ui/text-field'
import { describeError } from '@/lib/api/error'
import { logIn } from '@/lib/api/session'
import { safeNextPath } from '@/lib/next-path'
import { useAuthForm, type FieldIssues } from './use-auth-form'

export function LoginForm({ next }: { next?: string | undefined }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string>()
  const { issues, isPending, submit } = useAuthForm({
    send: logIn,
    nextPath: safeNextPath(next),
    onErrorCode: { invalid_credentials: (err) => setFormError(describeError(err)) }
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(undefined)
    const checks: FieldIssues = {}
    if (!email.trim()) checks.email = 'Enter your email.'
    if (!password) checks.password = 'Enter your password.'
    submit(checks, { email: email.trim(), password })
  }

  return (
    <Sheet as="section" className="flex flex-col gap-6 p-6 sm:p-8" aria-labelledby="login-title">
      <h1 id="login-title" className="text-title">
        Log in
      </h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <FormError>{formError}</FormError>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={issues.email}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={issues.password}
        />
        <Button type="submit" size="lg" loading={isPending} className="mt-2">
          Log in
        </Button>
      </form>
      <p className="text-sm text-ink-muted">
        New here?{' '}
        <Link href="/signup" className="font-semibold underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </Sheet>
  )
}
