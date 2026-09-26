import type { H3Event } from 'h3'
import { createError, getRequestHeader } from 'h3'
import { secretMatches } from './secret-match'

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i)
  return match?.[1] ?? null
}

/**
 * Gate for the `/api/admin/**` endpoints (ADR 0027): they need
 * `Authorization: Bearer <NUXT_ADMIN_TOKEN>`. A signed-in session isn't
 * enough. Without a configured token the endpoints are off (403).
 */
export function requireAdminToken(event: H3Event, adminToken = useRuntimeConfig(event).adminToken): void {
  if (!adminToken) {
    throw createError({ statusCode: 403, statusMessage: 'Admin endpoints are disabled' })
  }
  if (!secretMatches(bearerToken(getRequestHeader(event, 'authorization')), adminToken)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
