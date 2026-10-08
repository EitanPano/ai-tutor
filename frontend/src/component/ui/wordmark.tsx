import { cn } from '@/lib/cn'

/** The brand. "Tutor" carries the marker swipe: the one flourish in the product. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-lead font-extrabold tracking-tight text-ink', className)}>
      AI <span className="marker rounded-sm px-1">Tutor</span>
    </span>
  )
}
