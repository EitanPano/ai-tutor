import type { Metadata } from 'next'
import { QuizView } from '@/component/quiz/quiz-view'

export const metadata: Metadata = { title: 'Quiz' }

export default async function QuizPage({ params }: PageProps<'/quiz/[id]'>) {
  const { id } = await params
  // Keyed by id so moving between quizzes never carries answers across.
  return <QuizView key={id} quizId={id} />
}
