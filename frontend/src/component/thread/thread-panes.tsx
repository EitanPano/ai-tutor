'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ThreadList } from './thread-list'

/**
 * From `lg` up: the thread list beside the content pane. Below it, `/thread` stacks the new
 * question above the list, and a conversation takes the full width (it has a back link).
 */
export function ThreadPanes({ children }: { children: ReactNode }) {
  const activeId = /^\/thread\/([^/]+)/.exec(usePathname())?.[1]
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
      <aside
        aria-label="Your threads"
        className={`${activeId ? 'hidden lg:block' : 'order-2 lg:order-1'} lg:sticky lg:top-10 lg:-m-1 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:p-1`}
      >
        <ThreadList activeId={activeId} />
      </aside>
      <div className="order-1 min-w-0 lg:order-2">{children}</div>
    </div>
  )
}
