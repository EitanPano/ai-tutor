import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { BackIcon, type IconComponent } from '@/lib/icon'

type BackLinkProps = {
  href: string
  children: ReactNode
  /** Defaults to the back arrow. */
  icon?: IconComponent
  className?: string
}

/** The small text link above a page title that leads back to where the reader came from. */
export function BackLink({ href, children, icon: Icon = BackIcon, className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn('inline-flex items-center gap-1.5 self-start text-sm font-semibold', className)}
    >
      <Icon aria-hidden="true" className="size-4" />
      {children}
    </Link>
  )
}
