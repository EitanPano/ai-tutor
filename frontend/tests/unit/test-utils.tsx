import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

export const errorResponse = (
  status: number,
  code: string,
  message = 'x',
  details?: Record<string, unknown>
) =>
  jsonResponse(status, { error: { code, message, ...(details && { details }) }, requestId: 'r1' })

export function renderWithQuery(ui: ReactElement, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(client)
  return {
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
    client
  }
}
