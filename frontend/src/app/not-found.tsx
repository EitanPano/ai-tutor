import Link from 'next/link'
import { buttonClass } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { ThreadIcon } from '@/lib/icon'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <Sheet>
        <EmptyState
          icon={ThreadIcon}
          action={
            <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
              Back to threads
            </Link>
          }
        >
          This page does not exist.
        </EmptyState>
      </Sheet>
    </main>
  )
}
