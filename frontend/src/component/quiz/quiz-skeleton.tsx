import { SkeletonBar, SkeletonCard, SkeletonSection } from '@/component/ui/skeleton'

export function QuizSkeleton() {
  return (
    <SkeletonSection label="Loading quiz" className="gap-5">
      <SkeletonBar className="h-9 w-2/3" />
      <SkeletonCard className="h-96" />
    </SkeletonSection>
  )
}
