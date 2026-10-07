'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import { describeError } from '@/lib/api/error'
import { getProgress, progressKey } from '@/lib/api/progress'
import { RetryIcon } from '@/lib/icon'
import { useSession } from '@/lib/session'
import { ProfileForm } from './profile-form'
import { RecentActivity } from './recent-activity'
import { Streak } from './streak'
import { Totals } from './totals'
import { TopicTable } from './topic-table'

function ProgressSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading progress" className="flex flex-col gap-5">
      <div className="h-32 animate-pulse rounded-md border border-rule bg-sheet" />
      <div className="h-5 w-2/3 animate-pulse rounded-sm bg-rule" />
      <div className="h-80 animate-pulse rounded-md border border-rule bg-sheet" />
    </div>
  )
}

export function ProgressView() {
  const session = useSession()
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: ({ signal }) => getProgress(signal)
  })
  const user = session.data?.user
  const failed = progress.isError && !progress.data

  useEffect(() => {
    if (failed) toast.error(describeError(progress.error), { id: 'progress-error' })
  }, [failed, progress.error])

  const data = progress.data
  const topicName = (topicId: string) =>
    data?.topics.find((t) => t.topicId === topicId)?.topicName ?? topicId

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title">Progress</h1>
      {progress.isPending ? (
        <ProgressSkeleton />
      ) : !data ? (
        <Sheet>
          <EmptyState
            icon={RetryIcon}
            action={
              <Button variant="secondary" onClick={() => progress.refetch()}>
                Retry
              </Button>
            }
          >
            {describeError(progress.error)}
          </EmptyState>
        </Sheet>
      ) : (
        <>
          <div className="flex max-w-[72ch] flex-col gap-4">
            <Streak streak={data.streak} />
            <Totals totals={data.totals} />
          </div>
          <TopicTable topics={data.topics} />
        </>
      )}
      <div className="grid items-start gap-8 lg:grid-cols-2">
        {data && <RecentActivity activities={data.recent} topicName={topicName} />}
        {user && <ProfileForm user={user} />}
      </div>
    </div>
  )
}
