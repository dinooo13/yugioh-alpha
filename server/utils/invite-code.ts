import { APIError, createAuthMiddleware } from 'better-auth/api'
import { secretMatches } from './secret-match'

/**
 * Invite-only sign-up (ADR 0027). When `runtimeConfig.inviteCode`
 * (NUXT_INVITE_CODE) is set, `POST /api/auth/sign-up/email` needs an
 * `inviteCode` field matching it; one shared code, reusable. Unset = open
 * sign-up, as before (local dev).
 */

export const INVALID_INVITE_CODE = 'INVALID_INVITE_CODE'

/** Case, spaces and dashes don't matter, so `abcd-efgh` matches `ABCDEFGH`. */
export function normalizeInviteCode(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : ''
}

export function inviteCodeMatches(submitted: unknown, inviteCode: string): boolean {
  return secretMatches(normalizeInviteCode(submitted), normalizeInviteCode(inviteCode))
}

/** Better Auth `hooks.before` middleware that rejects sign-ups without the invite code ('' = let every sign-up through). */
export function inviteCodeGate(inviteCode: string) {
  return createAuthMiddleware(async (ctx) => {
    if (!inviteCode || ctx.path !== '/sign-up/email') {
      return
    }
    const body = ctx.body as { inviteCode?: unknown } | undefined
    if (!inviteCodeMatches(body?.inviteCode, inviteCode)) {
      throw new APIError('FORBIDDEN', {
        code: INVALID_INVITE_CODE,
        message: 'Invalid invite code',
      })
    }
  })
}
