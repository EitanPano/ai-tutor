'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { FormError } from '@/component/ui/form-error'
import { Sheet } from '@/component/ui/sheet'
import { TextField } from '@/component/ui/text-field'
import { describeError, fieldIssues, isApiError } from '@/lib/api/error'
import { logIn } from '@/lib/api/session'
import { safeNextPath } from '@/lib/next-path'
import { SESSION_KEY } from '@/lib/session'

export function LoginForm({ next }: { next?: string | undefined }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string>()
  const [issues, setIssues] = useState<Record<string, string>>({})

  const login = useMutation({
    mutationFn: logIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY, refetchType: 'all' })
      router.replace(safeNextPath(next))
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'invalid_credentials') {
        setFormError('Email or password is incorrect.')
      } else if (isApiError(err) && err.code === 'validation_failed') {
        setIssues(fieldIssues(err))
      } else {
        toast.error(describeError(err))
      }
    }
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(undefined)
    const nextIssues: Record<string, string> = {}
    if (!email.trim()) nextIssues.email = 'Enter your email.'
    if (!password) nextIssues.password = 'Enter your password.'
    setIssues(nextIssues)
    if (Object.keys(nextIssues).length > 0) return
    login.mutate({ email: email.trim(), password })
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
        <Button type="submit" size="lg" loading={login.isPending} className="mt-2">
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
