// better-auth surfaces its own English error strings via `error.message`
// (e.g. "Password too short") — displaying those verbatim reads as a bug in
// a translated UI (UX review #3). `error.code` is the stable,
// locale-independent identifier better-auth attaches to every error body; we
// translate the ones our email/password flows can actually hit
// (`auth.errors.<CODE>`, ADR 0014) and let the caller fall back to a generic
// message for everything else.
const KNOWN_AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'INVALID_EMAIL',
  'INVALID_EMAIL_OR_PASSWORD',
  // Ours: the sign-up invite code check (server/utils/invite-code.ts, ADR 0027).
  'INVALID_INVITE_CODE',
])

interface AuthClientError {
  code?: string | null
  message?: string | null
}

/** The message key for a better-auth error, or null when the code isn't one we translate. */
export function authErrorKey(error: AuthClientError | null | undefined): string | null {
  const code = error?.code
  return code && KNOWN_AUTH_ERROR_CODES.has(code) ? `auth.errors.${code}` : null
}
