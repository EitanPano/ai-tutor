import type { Metadata } from 'next'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { ProgressIcon } from '@/lib/icon'

export const metadata: Metadata = { title: 'Progress' }

// Placeholder until the progress dashboard lands.
export default function ProgressPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">Progress</h1>
      <Sheet>
        <EmptyState icon={ProgressIcon}>
          Nothing to show yet. Finish a quiz or check off a guide step and it appears here.
        </EmptyState>
      </Sheet>
    </div>
  )
}
