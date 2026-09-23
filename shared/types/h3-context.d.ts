import type { AppLocale } from '../locale'

// Per-request UI language (ADR 0014), set by server/utils/ui-locale.ts. In
// shared/ so both the server and the app tsconfig see it: the app plugin
// reads it through `useRequestEvent()` during SSR.
declare module 'h3' {
  interface H3EventContext {
    /** Resolved once per request, then cached here. */
    uiLocale?: AppLocale
    /** True when the resolved locale came from the user's profile. */
    uiLocaleFromProfile?: boolean
    /** Lazy resolver installed by server/plugins/ui-locale.ts. */
    resolveUiLocale?: () => Promise<AppLocale>
  }
}

export {}
