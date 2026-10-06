import type { Metadata } from 'next'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { ThreadIcon } from '@/lib/icon'

export const metadata: Metadata = { title: 'Threads' }

// Placeholder until the thread list and composer land.
export default function ThreadPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">Threads</h1>
      <Sheet>
        <EmptyState icon={ThreadIcon}>No threads yet. Ask your first question.</EmptyState>
      </Sheet>
    </div>
  )
}
