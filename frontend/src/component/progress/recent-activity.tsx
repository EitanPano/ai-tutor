import Link from 'next/link'
import type { ComponentType, SVGProps } from 'react'
import { buttonClass } from '@/component/ui/button'
import { EmptyState } from '@/component/ui/empty-state'
import { Sheet } from '@/component/ui/sheet'
import type { Activity } from '@/lib/api/progress'
import { GuideIcon, QuizIcon, ThreadIcon } from '@/lib/icon'
import { relativeTime } from '@/lib/relative-time'

type Kind = {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Read out before the title, so a screen reader hears what happened. */
  verb: string
  href: (activity: Activity) => string | null
}

const link = (base: string, id: string | null) => (id ? `${base}/${encodeURIComponent(id)}` : null)

const KIND: Record<Activity['kind'], Kind> = {
  question: { icon: ThreadIcon, verb: 'Question', href: (a) => link('/thread', a.threadId) },
  step: { icon: GuideIcon, verb: 'Guide step', href: (a) => link('/guide', a.guideId) },
  attempt: { icon: QuizIcon, verb: 'Quiz attempt', href: (a) => link('/quiz', a.quizId) }
}

type RecentActivityProps = {
  activities: Activity[]
  topicName: (topicId: string) => string
}

export function RecentActivity({ activities, topicName }: RecentActivityProps) {
  return (
    <section aria-labelledby="recent-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="recent-heading" className="text-lead">
        Recent activity
      </h2>
      <Sheet>
        {activities.length === 0 ? (
          <EmptyState
            icon={ThreadIcon}
            action={
              <Link href="/thread" className={buttonClass({ variant: 'secondary' })}>
                Ask a question
              </Link>
            }
          >
            Nothing here yet. Ask your first question.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-rule">
            {activities.map((activity, index) => {
              const { icon: Icon, verb, href } = KIND[activity.kind]
              const target = href(activity)
              const body = (
                <>
                  <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">
                      <span className="sr-only">{verb}:</span> {activity.title}
                    </span>{' '}
                    <span className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
                      <span>{topicName(activity.topicId)}</span>{' '}
                      <time dateTime={activity.at}>{relativeTime(activity.at)}</time>
                    </span>
                  </span>
                </>
              )
              const rowClass = 'flex items-start gap-3 px-4 py-3'
              return (
                <li key={`${activity.kind}-${activity.at}-${index}`}>
                  {target ? (
                    <Link
                      href={target}
                      className={`${rowClass} text-ink no-underline hover:bg-ink/5`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={rowClass}>{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Sheet>
    </section>
  )
}
