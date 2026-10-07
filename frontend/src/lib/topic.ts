import { useQuery } from '@tanstack/react-query'
import { listTopics } from '@/lib/api/topic'

export const DEFAULT_TOPIC_ID = 'other'

export function useTopics() {
  return useQuery({
    queryKey: ['topic'],
    queryFn: ({ signal }) => listTopics(signal),
    // The taxonomy is fixed server-side; one fetch per page session is plenty.
    staleTime: Infinity,
    select: (data) => data.topics
  })
}
