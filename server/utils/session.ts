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

/**
 * Resolves the better-auth session without requiring it. Returns null for
 * anonymous requests instead of throwing — the read side of the public
 * /spieler/** routes, where a session only changes *how much* is visible.
 * A malformed cookie must not 500 a public page, so any failure is treated
 * the same as "no session".
 */
export async function getOptionalUser(event: H3Event): Promise<RequiredUser | null> {
  try {
    const session = await useAuth().api.getSession({ headers: event.headers })
    return session?.user?.id ? { id: session.user.id } : null
  }
  catch {
    return null
  }
}
