import type { components } from '@/types/api'
import { apiFetch } from './client'

type UserResponse = components['schemas']['UserResponse']
type LoginRequest = components['schemas']['LoginRequest']

export const getSession = (signal?: AbortSignal) =>
  apiFetch<UserResponse>('/api/session', { signal })

export const logIn = (input: LoginRequest) =>
  apiFetch<UserResponse>('/api/session', { method: 'POST', body: input })

export const logOut = () => apiFetch<void>('/api/session', { method: 'DELETE' })
