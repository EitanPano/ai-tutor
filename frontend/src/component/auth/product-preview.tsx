import { Sheet } from '@/component/ui/sheet'

/** Static picture of the product: a question and the start of its explanation. */
export function ProductPreview() {
  return (
    <div aria-hidden="true" className="flex w-full max-w-[34rem] flex-col gap-4">
      <Sheet className="ml-auto max-w-[28rem] px-5 py-4">
        <p className="mb-1 text-sm text-ink-muted">You asked</p>
        <p className="text-lead font-semibold">Why does my useEffect run twice in development?</p>
      </Sheet>
      <Sheet className="px-5 py-5">
        <p className="mb-1 text-sm text-ink-muted">Explanation</p>
        <p className="mb-3">
          In development, React 18 mounts every component, unmounts it, then mounts it again.{' '}
          <span className="marker">
            That second run checks that your effect cleans up after itself.
          </span>{' '}
          It never happens in production.
        </p>
        <pre className="overflow-hidden rounded-md bg-code px-4 py-3 font-mono text-sm leading-relaxed text-code-ink">
          {`useEffect(() => {
  const id = setInterval(tick, 1000)
  return () => clearInterval(id)
}, [])`}
        </pre>
      </Sheet>
    </div>
  )
}
