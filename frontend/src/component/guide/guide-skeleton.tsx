import { SkeletonBar, SkeletonCard, SkeletonSection } from '@/component/ui/skeleton'

export function GuideSkeleton() {
  return (
    <SkeletonSection label="Loading guide">
      <SkeletonBar className="h-9 w-2/3" />
      <SkeletonBar className="h-2 w-full" />
      <SkeletonCard className="h-96" />
    </SkeletonSection>
  )
}
