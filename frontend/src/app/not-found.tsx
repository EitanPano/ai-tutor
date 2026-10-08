import Link from 'next/link'
import { buttonClass } from '@/component/ui/button'
import { ErrorPanel } from '@/component/ui/error-panel'
import { ThreadIcon } from '@/lib/icon'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <ErrorPanel
        icon={ThreadIcon}
        action={
          <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
            Back to threads
          </Link>
        }
      >
        This page does not exist.
      </ErrorPanel>
    </main>
  )
}
