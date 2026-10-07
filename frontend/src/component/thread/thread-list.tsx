'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button, buttonClass } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { describeError } from '@/lib/api/error'
import { listThreads, threadKey } from '@/lib/api/thread'
import { NewIcon, RetryIcon, ThreadIcon } from '@/lib/icon'
import { relativeTime } from '@/lib/relative-time'
import { useTopics } from '@/lib/topic'

export function ThreadList({ activeId }: { activeId?: string | undefined }) {
  const topics = useTopics()
  const threads = useInfiniteQuery({
    queryKey: threadKey.list,
    queryFn: ({ pageParam, signal }) =>
      listThreads({ ...(pageParam && { cursor: pageParam }), signal }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined
  })
  const topicName = new Map(topics.data?.map((topic) => [topic.id, topic.name]))
  const rows = threads.data?.pages.flatMap((page) => page.threads) ?? []

  return (
    <section aria-labelledby="thread-list-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="thread-list-heading" className="text-lead">
          Threads
        </h2>
        <Link href="/thread" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          <NewIcon aria-hidden="true" className="size-4" />
          New thread
        </Link>
      </div>

      {threads.isPending ? (
        <div aria-busy="true" aria-label="Loading threads" className="flex flex-col gap-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-16 animate-pulse rounded-md border border-rule bg-sheet" />
          ))}
        </div>
      ) : !threads.data ? (
        <div className="rounded-md border border-rule bg-sheet">
          <EmptyState
            icon={RetryIcon}
            action={
              <Button variant="secondary" onClick={() => threads.refetch()}>
                Retry
              </Button>
            }
          >
            {describeError(threads.error)}
          </EmptyState>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-rule bg-sheet">
          <EmptyState icon={ThreadIcon}>No threads yet. Ask your first question.</EmptyState>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((thread) => {
              const active = thread.id === activeId
              return (
                <li key={thread.id}>
                  <Link
                    href={`/thread/${thread.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`flex flex-col gap-0.5 rounded-md border bg-sheet px-3 py-2.5 hover:border-ink-muted ${
                      active ? 'border-ink' : 'border-rule'
                    }`}
                  >
                    <span className="min-w-0 truncate font-semibold text-ink">
                      <span className={active ? 'marker rounded-sm px-1' : 'px-1'}>
                        {thread.title}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 px-1 text-sm text-ink-muted">
                      <span className="truncate">{topicName.get(thread.topicId) ?? ''}</span>
                      <time dateTime={thread.updatedAt} className="shrink-0">
                        {relativeTime(thread.updatedAt)}
                      </time>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {threads.hasNextPage && (
            <Button
              variant="secondary"
              onClick={() => threads.fetchNextPage()}
              loading={threads.isFetchingNextPage}
            >
              Load more
            </Button>
          )}
          {threads.isFetchNextPageError && (
            <p role="alert" className="text-sm text-wrong">
              {describeError(threads.error)}
            </p>
          )}
        </>
      )}
    </section>
  )
}
