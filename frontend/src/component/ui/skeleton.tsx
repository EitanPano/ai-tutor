import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Sheet } from './sheet'

// Whole class names, so Tailwind finds them in the source.
const GAP_CLASS = { 2: 'gap-2', 4: 'gap-4', 5: 'gap-5' } as const

/**
 * A busy placeholder named by `label` ("Loading guide"); its bars and cards are decoration.
 * A `div`, not a `section`: a loading state is not a landmark. `gap` spaces them on Tailwind's
 * scale; the default matches a page's sections.
 */
export function SkeletonSection({
  label,
  gap = 5,
  children
}: {
  label: string
  gap?: keyof typeof GAP_CLASS
  children: ReactNode
}) {
  return (
    <div aria-busy="true" aria-label={label} className={cn('flex flex-col', GAP_CLASS[gap])}>
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
