import type { Metadata } from 'next'
import { AttemptView } from '@/component/quiz/attempt-view'

export const metadata: Metadata = { title: 'Quiz review' }

export default async function AttemptPage({ params }: PageProps<'/quiz/[id]/attempt/[attemptId]'>) {
  const { id, attemptId } = await params
  return <AttemptView key={attemptId} quizId={id} attemptId={attemptId} />
}
