import type { components } from '@/types/api'
import { apiFetch } from './client'

type UserResponse = components['schemas']['UserResponse']
type SignupRequest = components['schemas']['SignupRequest']
type UpdateUserRequest = components['schemas']['UpdateUserRequest']

export const signUp = (input: SignupRequest) =>
  apiFetch<UserResponse>('/api/user', { method: 'POST', body: input })

export const updateUser = (input: UpdateUserRequest) =>
  apiFetch<UserResponse>('/api/user', { method: 'PATCH', body: input })
