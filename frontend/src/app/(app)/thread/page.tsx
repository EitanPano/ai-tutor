import type { Metadata } from 'next'
import { Suspense } from 'react'
import { NewQuestion } from '@/component/thread/new-question'

export const metadata: Metadata = { title: 'New question' }

export default function ThreadPage() {
  // `NewQuestion` reads `?topic=` on the client, which needs a Suspense boundary.
  return (
    <Suspense>
      <NewQuestion />
    </Suspense>
  )
}
