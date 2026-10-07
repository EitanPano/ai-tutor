import type { ReactNode } from 'react'
import { ThreadPanes } from '@/component/thread/thread-panes'

export default function ThreadLayout({ children }: { children: ReactNode }) {
  return <ThreadPanes>{children}</ThreadPanes>
}
