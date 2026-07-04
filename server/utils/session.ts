import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useAuth } from './auth'

export interface RequiredUser {
  id: string
}

export async function requireUser(event: H3Event): Promise<RequiredUser> {
  const session = await useAuth().api.getSession({ headers: event.headers })

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
    })
  }

  return { id: session.user.id }
}
