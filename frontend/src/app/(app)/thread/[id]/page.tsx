import type { Metadata } from 'next'
import { Conversation } from '@/component/thread/conversation'

export const metadata: Metadata = { title: 'Conversation' }

export default async function ConversationPage({ params }: PageProps<'/thread/[id]'>) {
  const { id } = await params
  // Keyed by id so moving between threads never carries stream or draft state across.
  return <Conversation key={id} threadId={id} />
}
