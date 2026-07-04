import type { H3Event } from 'h3'
import { useAuth } from './auth'

export async function requireSession(event: H3Event) {
  const session = await useAuth().api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  return session
}
