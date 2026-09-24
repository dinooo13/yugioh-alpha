import { apiErrorCode, apiErrorParams } from '~/utils/card-entry'

/**
 * Translates an API error code in the interface language (ADR 0014): the
 * message under `errors.api.<code>` (with the error's named `params`, e.g.
 * `{ max }`) when there is one, else the caller's fallback key.
 *
 * Also used for per-item errors (`/api/inventory/bulk`'s `data.errors[]`,
 * which carry their own `code`/`params`).
 */
export function useApiErrorCode() {
  const { t, te } = useI18n()
  return (code: string | undefined, params: Record<string, unknown> | undefined, fallbackKey: string): string => {
    const key = code ? `errors.api.${code}` : undefined
    return key && te(key) ? t(key, params ?? {}) : t(fallbackKey)
  }
}

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
  const translate = useApiErrorCode()
  return (error: unknown, fallbackKey: string): string =>
    translate(apiErrorCode(error), apiErrorParams(error), fallbackKey)
}
