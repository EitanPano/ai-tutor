'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { describeError, isApiError } from '@/lib/api/error'
import { createGuide, guideKey, type GuideSummary } from '@/lib/api/guide'
import { threadKey } from '@/lib/api/thread'
import { GuideIcon } from '@/lib/icon'

/** Failures worth a Retry: nothing about the thread itself is wrong. */
const RETRYABLE = new Set(['ai_invalid_output', 'ai_provider_error'])

type GuideToolsProps = {
  threadId: string
  /** The thread has at least one complete tutor answer to build a guide from. */
  hasAnswer: boolean
  /** An answer is being written right now; a guide must wait for it. */
  busy: boolean
  /** Newest first. */
  guides: GuideSummary[]
}

/**
 * The study-tools toolbar of a conversation. Memoised on purpose: its props only change when the
 * thread's answers or guides do, so typing in the composer never re-renders it.
 */
export const GuideTools = memo(function GuideTools({
  threadId,
  hasAnswer,
  busy,
  guides
}: GuideToolsProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const toastId = useRef<string | number | undefined>(undefined)

  // A toast's Retry must not outlive the page it belongs to.
  useEffect(
    () => () => {
      if (toastId.current !== undefined) toast.dismiss(toastId.current)
    },
    []
  )

  const create = useMutation({
    mutationFn: () => createGuide(threadId),
    onSuccess: ({ guide }) => {
      void queryClient.invalidateQueries({ queryKey: threadKey.detail(threadId) })
      queryClient.setQueryData(guideKey.detail(guide.id), { guide })
      router.push(`/guide/${encodeURIComponent(guide.id)}`)
    },
    onError: (err) => {
      const retryable = isApiError(err) && RETRYABLE.has(err.code)
      toastId.current = toast.error(describeError(err), {
        ...(retryable && { action: { label: 'Retry', onClick: () => create.mutate() } })
      })
    }
  })

  const reason = !hasAnswer ? 'Ask a question first' : busy ? 'Wait for the answer to finish' : ''
  const disabled = !!reason

  return (
    <div className="flex flex-col gap-3">
      <div role="toolbar" aria-label="Study tools" className="flex flex-wrap items-center gap-3">
        <Button
          loading={create.isPending}
          disabled={disabled}
          aria-describedby={disabled ? 'guide-reason' : undefined}
          onClick={() => create.mutate()}
        >
          {!create.isPending && <GuideIcon aria-hidden="true" className="size-4" />}
          {create.isPending ? 'Writing your guide…' : 'Guide me step by step'}
        </Button>
        {disabled && (
          <p id="guide-reason" className="text-sm text-ink-muted">
            {reason}
          </p>
        )}
      </div>
      {guides.length > 0 && (
        <ul aria-label="Guides for this thread" className="flex flex-col gap-1">
          {guides.map((guide) => (
            <li key={guide.id}>
              <Link
                href={`/guide/${encodeURIComponent(guide.id)}`}
                className="inline-flex max-w-full items-center gap-2 text-sm font-semibold"
              >
                <GuideIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate">
                  Open guide: {guide.title} ({guide.doneCount} of {guide.stepCount} done)
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
