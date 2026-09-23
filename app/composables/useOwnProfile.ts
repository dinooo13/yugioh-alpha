import type { OwnProfile } from '~~/shared/sharing'

/**
 * The signed-in user's own profile (lazily created server-side on first
 * read — see server/utils/profiles.ts ensureProfile). Only needed to build a
 * `/spieler/:handle/...` share link (inventory collection menu, decks list,
 * deck editor).
 *
 * A shared `key` means Nuxt dedupes this across every caller on the same
 * page — without it, each `useFetch('/api/profile')` call site gets its own
 * auto-key (derived from the call site), so e.g. the layout and the /decks
 * page each issue their own request instead of sharing one payload.
 */
export function useOwnProfile() {
  return useFetch<OwnProfile>('/api/profile', {
    key: 'own-profile',
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  })
}
