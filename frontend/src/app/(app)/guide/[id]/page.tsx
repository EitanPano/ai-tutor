import type { Metadata } from 'next'
import { GuideViewer } from '@/component/guide/guide-viewer'

export const metadata: Metadata = { title: 'Guide' }

export default async function GuidePage({ params }: PageProps<'/guide/[id]'>) {
  const { id } = await params
  // Keyed by id so moving between guides never carries the focused step across.
  return <GuideViewer key={id} guideId={id} />
}
