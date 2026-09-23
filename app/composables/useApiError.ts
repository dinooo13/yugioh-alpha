import { apiErrorCode } from '~/utils/card-entry'

/**
 * Turns a failed `$fetch` into a message in the interface language
 * (ADR 0014): the translation of the error's `data.code` under
 * `errors.api.<code>` when there is one, else the caller's fallback key.
 * The server's `statusMessage` is technical English and is never shown.
 *
 * Replaces `apiErrorMessage` from `~/utils/card-entry`; each #34 F2 PR
 * migrates the call sites of its own area.
 */
export function useApiError() {
  const { t, te } = useI18n()
  return (error: unknown, fallbackKey: string): string => {
    const code = apiErrorCode(error)
    const key = code ? `errors.api.${code}` : undefined
    return key && te(key) ? t(key) : t(fallbackKey)
  }
}
