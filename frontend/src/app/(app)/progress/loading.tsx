import { ProgressSkeleton } from '@/component/progress/progress-skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title">Progress</h1>
      <ProgressSkeleton />
    </div>
  )
}
