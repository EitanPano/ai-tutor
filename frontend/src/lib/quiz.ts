import type { Difficulty } from '@/lib/api/quiz'

export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

export const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' }
]

export const difficultyLabel = (difficulty: Difficulty) =>
  DIFFICULTIES.find((d) => d.value === difficulty)?.label ?? difficulty

/** "Oct 6": the day an attempt was made, in the reader's locale and time zone. */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
