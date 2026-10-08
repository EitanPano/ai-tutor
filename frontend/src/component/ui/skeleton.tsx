import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Sheet } from './sheet'

/**
 * A busy placeholder named by `label` ("Loading guide"); its bars and cards are decoration.
 * A `div`, not a `section`: a loading state is not a landmark. Set the gap with `className`.
 */
export function SkeletonSection({
  label,
  className,
  children
}: {
  label: string
  className: string
  children: ReactNode
}) {
  return (
    <div aria-busy="true" aria-label={label} className={cn('flex flex-col', className)}>
      {children}
    </div>
  )
}

/** A line of text still loading. Size it with `h-*` and `w-*`. */
export function SkeletonBar({ className }: { className: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-rule', className)} />
}

/** A sheet still loading. Size it with `h-*`. */
export function SkeletonCard({ className }: { className: string }) {
  return <Sheet className={cn('animate-pulse', className)} />
}
