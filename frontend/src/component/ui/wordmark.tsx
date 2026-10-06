/** The brand. "Tutor" carries the marker swipe: the one flourish in the product. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`text-lead font-extrabold tracking-tight text-ink ${className}`.trim()}>
      AI <span className="marker rounded-sm px-1">Tutor</span>
    </span>
  )
}
