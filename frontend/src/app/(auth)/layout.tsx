import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { ProductPreview } from '@/component/auth/product-preview'
import { SignedInRedirect } from '@/component/auth/signed-in-redirect'
import { Wordmark } from '@/component/ui/wordmark'

const PRODUCT_LINE =
  'Ask a coding question. Get an explanation, a step-by-step guide you can check off, and a quiz to make it stick.'

// Same cookie name the proxy and the API use.
const SESSION_COOKIE = 'sid'

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Only a visitor who has a session cookie can be signed in: probing /api/session without one
  // would just log a 401 in the console on every visit to /login.
  const hasSession = (await cookies()).has(SESSION_COOKIE)
  return (
    <div className="graph-paper flex min-h-screen items-center justify-center px-4 py-10 sm:px-10">
      {hasSession && <SignedInRedirect />}
      <div className="grid w-full max-w-6xl items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)]">
        <section className="hidden flex-col gap-10 lg:flex">
          <Wordmark className="text-title" />
          <p className="max-w-[34rem] text-lead">{PRODUCT_LINE}</p>
          <ProductPreview />
        </section>
        <main className="flex flex-col gap-6">
          <div className="mx-auto flex w-full max-w-md flex-col gap-6">
            <div className="flex flex-col gap-3 lg:hidden">
              <Wordmark className="text-title" />
              <p className="text-lead">{PRODUCT_LINE}</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
