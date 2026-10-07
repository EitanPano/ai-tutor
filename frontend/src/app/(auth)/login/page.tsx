import type { Metadata } from 'next'
import { LoginForm } from '@/component/auth/login-form'

export const metadata: Metadata = { title: 'Log in' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams
  return <LoginForm next={typeof next === 'string' ? next : undefined} />
}
