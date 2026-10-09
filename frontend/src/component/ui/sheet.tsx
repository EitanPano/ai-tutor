import type { ElementType, HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type SheetProps = HTMLAttributes<HTMLElement> & { as?: ElementType }

/** A sheet of paper: the solid reading surface that sits on the graph-paper canvas. */
export function Sheet({ as: Tag = 'div', className, ...rest }: SheetProps) {
  return <Tag className={cn('rounded-md border border-rule bg-sheet', className)} {...rest} />
}
