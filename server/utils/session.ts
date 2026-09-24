import type { H3Event } from 'h3'
import { createError } from 'h3'
import { useAuth } from './auth'

export interface RequiredUser {
  id: string
}

/**
 * The session's user, looked up once per request and cached on
 * `event.context.authUser` (`null` = anonymous): the endpoint and the UI- and
 * card-language resolvers (ADR 0014/0015) all ask for it, and better-auth's
 * `getSession` is a database round trip each time.
 */
async function loadSessionUser(event: H3Event): Promise<RequiredUser | null> {
  if (event.context.authUser !== undefined) {
    return event.context.authUser
  }
  const session = await useAuth().api.getSession({ headers: event.headers })
  const authUser = session?.user?.id ? { id: session.user.id } : null
  event.context.authUser = authUser
  return authUser
}

export async function requireUser(event: H3Event): Promise<RequiredUser> {
  const authUser = await loadSessionUser(event)

  if (!authUser) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
    })
  }

  return authUser
}

/**
 * Resolves the better-auth session without requiring it. Returns null for
 * anonymous requests instead of throwing — the read side of the public
 * /players/** routes, where a session only changes *how much* is visible.
 * A malformed cookie must not 500 a public page, so any failure is treated
 * the same as "no session".
 */
export async function getOptionalUser(event: H3Event): Promise<RequiredUser | null> {
  try {
    return await loadSessionUser(event)
  }
  catch {
    return null
  }
}
