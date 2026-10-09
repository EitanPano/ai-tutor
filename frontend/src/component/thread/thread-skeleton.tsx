import { SkeletonBar, SkeletonCard, SkeletonSection } from '@/component/ui/skeleton'

export function ThreadSkeleton() {
  return (
    <SkeletonSection label="Loading thread" gap={4}>
      <SkeletonBar className="h-9 w-2/3" />
      <SkeletonCard className="h-64" />
    </SkeletonSection>
  )
}
