import type { AppLocale } from '../locale'

// Per-request language state (ADR 0014, ADR 0015), set by
// server/utils/ui-locale.ts and server/utils/session.ts. In shared/ so both
// the server and the app tsconfig see it: the app plugin reads it through
// `useRequestEvent()` during SSR.
declare module 'h3' {
  interface H3EventContext {
    /** The session's user, cached by server/utils/session.ts; `null` = anonymous, unset = not looked up yet. */
    authUser?: { id: string } | null
    /** The signed-in user's language choices, read once per request; `null` = anonymous or no profile yet. */
    localeChoices?: { locale: AppLocale | null, cardLocale: AppLocale | null } | null
    /** Resolved once per request, then cached here. */
    uiLocale?: AppLocale
    /** True when the resolved locale came from the user's profile. */
    uiLocaleFromProfile?: boolean
    /** Lazy resolver installed by server/plugins/ui-locale.ts. */
    resolveUiLocale?: () => Promise<AppLocale>
    /** The profile's card language (ADR 0015), cached; `null` = follow the interface language. */
    cardLocaleChoice?: AppLocale | null
    /** Lazy resolver installed by server/plugins/ui-locale.ts. */
    resolveCardLocaleChoice?: () => Promise<AppLocale | null>
  }
}

export {}
