import type { Metadata } from 'next'
import { SignupForm } from '@/component/auth/signup-form'

export const metadata: Metadata = { title: 'Create account' }

export default function SignupPage() {
  return <SignupForm />
}
