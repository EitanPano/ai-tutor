import { NotFoundPanel } from '@/component/ui/not-found-panel'
import { ThreadIcon } from '@/lib/icon'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <NotFoundPanel icon={ThreadIcon}>This page does not exist.</NotFoundPanel>
    </main>
  )
}
