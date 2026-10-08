'use client'

import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { ErrorPanel } from '@/component/ui/error-panel'
import { SkeletonBar, SkeletonCard, SkeletonSection } from '@/component/ui/skeleton'
import { Wordmark } from '@/component/ui/wordmark'
import { describeError, isApiError } from '@/lib/api/error'
import { logOut } from '@/lib/api/session'
import { LogOutIcon, ProgressIcon, ThreadIcon } from '@/lib/icon'
import { isPathUnder } from '@/lib/route'
import { useSession } from '@/lib/session'

const NAV = [
  { href: '/thread', label: 'Threads', icon: ThreadIcon },
  { href: '/progress', label: 'Progress', icon: ProgressIcon }
] as const

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Main" className="flex gap-1 md:flex-col">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isPathUnder(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-ink hover:bg-ink/10"
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span className={active ? 'marker rounded-sm px-1 font-semibold' : 'px-1'}>
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [leaving, setLeaving] = useState(false)
  const session = useSession({ enabled: !leaving })
  const user = session.data?.user
  // A failed refetch keeps its cached data; only a first-load failure should replace the page.
  const sessionFailed = session.isError && !session.data

  async function handleLogOut() {
    setLeaving(true)
    try {
      await logOut()
    } catch (err) {
      // An already-ended session is the outcome we wanted; anything else keeps the user here.
      if (!(isApiError(err) && err.code === 'unauthenticated')) {
        setLeaving(false)
        toast.error(describeError(err))
        return
      }
    }
    queryClient.clear()
    router.replace('/login')
    toast('Logged out')
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-sheet px-4 py-3 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:flex-col md:items-stretch md:justify-start md:gap-6 md:border-r md:border-b-0 md:p-5">
        <Link href="/thread" aria-label="AI Tutor home" className="md:px-3">
          <Wordmark />
        </Link>
        <NavLinks pathname={pathname} />
        <div className="flex items-center gap-3 md:mt-auto md:flex-col md:items-stretch md:gap-2 md:border-t md:border-rule md:pt-4">
          {user ? (
            <p className="max-w-[16ch] truncate text-sm font-semibold md:max-w-none md:px-3">
              {user.displayName}
            </p>
          ) : (
            <SkeletonBar className="h-5 w-24 md:mx-3" />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogOut}
            disabled={leaving || !user}
            className="md:justify-start"
          >
            <LogOutIcon aria-hidden="true" className="size-4" />
            Log out
          </Button>
        </div>
      </aside>
      <main className="graph-paper min-w-0 flex-1 px-4 py-8 md:px-10 md:py-10">
        <div
          className={`mx-auto w-full ${
            pathname.startsWith('/thread') ||
            pathname.startsWith('/guide') ||
            pathname.startsWith('/progress')
              ? 'max-w-[76rem]'
              : 'max-w-[72ch]'
          }`}
        >
          {sessionFailed ? (
            isApiError(session.error) && session.error.code === 'unauthenticated' ? null : (
              <ErrorPanel onRetry={() => session.refetch()}>
                {describeError(session.error)}
              </ErrorPanel>
            )
          ) : user ? (
            children
          ) : (
            <SkeletonSection label="Loading" className="gap-4">
              <SkeletonBar className="h-8 w-40" />
              <SkeletonCard className="h-48" />
            </SkeletonSection>
          )}
        </div>
      </main>
    </div>
  )
}
