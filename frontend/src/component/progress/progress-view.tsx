'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { ErrorPanel } from '@/component/ui/error-panel'
import { describeError } from '@/lib/api/error'
import { getProgress, progressKey } from '@/lib/api/progress'
import { useSession } from '@/lib/session'
import { ProfileForm } from './profile-form'
import { ProgressSkeleton } from './progress-skeleton'
import { RecentActivity } from './recent-activity'
import { Streak } from './streak'
import { Totals } from './totals'
import { TopicTable } from './topic-table'

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
        <ErrorPanel onRetry={() => progress.refetch()}>{describeError(progress.error)}</ErrorPanel>
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
