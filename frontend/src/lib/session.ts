import { useQuery } from '@tanstack/react-query'
import { getSession } from '@/lib/api/session'

export const SESSION_KEY = ['session'] as const

export function useSession({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => getSession(signal),
    staleTime: 60_000,
    enabled
  })
}
