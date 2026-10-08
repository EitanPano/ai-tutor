import { SkeletonBar, SkeletonCard, SkeletonSection } from '@/component/ui/skeleton'

export function ProgressSkeleton() {
  return (
    <SkeletonSection label="Loading progress">
      <SkeletonCard className="h-32" />
      <SkeletonBar className="h-5 w-2/3" />
      <SkeletonCard className="h-80" />
    </SkeletonSection>
  )
}
