import Link from 'next/link'
import type { ReactNode } from 'react'
import type { IconComponent } from '@/lib/icon'
import { THREAD_LIST_PATH } from '@/lib/route'
import { buttonClass } from './button'
import { ErrorPanel } from './error-panel'

type NotFoundPanelProps = {
  /** The kind of thing that is gone: a thread, a guide, a quiz. */
  icon: IconComponent
  /** One sentence naming what does not exist. */
  children: ReactNode
}

/**
 * A thing that is gone (404). No Retry, since asking again cannot bring it back: a way back to
 * the threads instead.
 */
export function NotFoundPanel({ icon, children }: NotFoundPanelProps) {
  return (
    <ErrorPanel
      icon={icon}
      action={
        <Link href={THREAD_LIST_PATH} className={buttonClass({ variant: 'secondary' })}>
          Back to threads
        </Link>
      }
    >
      {children}
    </ErrorPanel>
  )
}
