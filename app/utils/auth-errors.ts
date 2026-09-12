// better-auth surfaces its own English error strings via `error.message`
// (e.g. "Password too short") — displaying those verbatim in an otherwise
// fully German UI reads as a bug (UX review #3). `error.code` is the stable,
// locale-independent identifier better-auth attaches to every error body; we
// map the ones our email/password flows can actually hit to German text and
// fall back to a generic message for everything else.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  PASSWORD_TOO_SHORT: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
  PASSWORD_TOO_LONG: 'Das Passwort ist zu lang.',
  USER_ALREADY_EXISTS: 'Diese E-Mail-Adresse ist bereits registriert.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Diese E-Mail-Adresse ist bereits registriert.',
  INVALID_EMAIL: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  INVALID_EMAIL_OR_PASSWORD: 'E-Mail-Adresse oder Passwort ist falsch.',
}

interface AuthClientError {
  code?: string | null
  message?: string | null
}

export function authErrorMessage(error: AuthClientError | null | undefined, fallback: string): string {
  const code = error?.code
  if (code && code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[code]!
  }
  return fallback
}
