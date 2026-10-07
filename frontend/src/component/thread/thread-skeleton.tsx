export function ThreadSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading thread" className="flex flex-col gap-4">
      <div className="h-9 w-2/3 animate-pulse rounded-sm bg-rule" />
      <div className="h-64 animate-pulse rounded-md border border-rule bg-sheet" />
    </div>
  )
}
