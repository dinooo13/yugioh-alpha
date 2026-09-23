import type { OwnProfile } from '~~/shared/sharing'

/**
 * The signed-in user's own profile (lazily created server-side on first
 * read — see server/utils/profiles.ts ensureProfile). Used for the layout
 * avatars (sidebar user block, public header "Mein Profil", #50), the /profile
 * page, and to build `/players/:handle/...` share links (inventory collection
 * menu, decks list, deck editor).
 *
 * A shared `key` means Nuxt dedupes this across every caller on the same
 * page — without it, each `useFetch('/api/profile')` call site gets its own
 * auto-key (derived from the call site), so e.g. the layout and the /decks
 * page each issue their own request instead of sharing one payload. It also
 * means writing `data.value` (e.g. after saving the profile form) updates the
 * layout avatar and name right away.
 *
 * `immediate: false` skips the request until `execute()` is called — the
 * public layout uses that for anonymous visitors, who have no profile.
 */
export function useOwnProfile(options: { immediate?: boolean } = {}) {
  return useFetch<OwnProfile>('/api/profile', {
    key: 'own-profile',
    immediate: options.immediate ?? true,
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  })
}
