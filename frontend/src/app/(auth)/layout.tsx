import type { ReactNode } from 'react'
import { ProductPreview } from '@/component/auth/product-preview'
import { SignedInRedirect } from '@/component/auth/signed-in-redirect'
import { Wordmark } from '@/component/ui/wordmark'

const PRODUCT_LINE =
  'Ask a coding question. Get an explanation, a step-by-step guide you can check off, and a quiz to make it stick.'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(26rem,32rem)]">
      <SignedInRedirect />
      <section className="graph-paper hidden flex-col justify-center gap-10 border-r border-rule px-12 py-12 lg:flex xl:px-20">
        <Wordmark className="text-title" />
        <p className="max-w-[34rem] text-lead">{PRODUCT_LINE}</p>
        <ProductPreview />
      </section>
      <main className="flex flex-col justify-center gap-6 px-4 py-10 sm:px-10 lg:bg-canvas">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col gap-3 lg:hidden">
            <Wordmark className="text-title" />
            <p className="text-lead">{PRODUCT_LINE}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
