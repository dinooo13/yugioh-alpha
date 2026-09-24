import type { OwnProfile } from '~~/shared/sharing'
import type { AppLocale } from '~~/shared/locale'
import { CARD_LOCALE_CHOICE_STATE } from '~/utils/ui-locale'

/**
 * The card language (ADR 0015): which name and text cards are shown with.
 *
 * - `choice`: the signed-in user's profile setting, `null` = "follow the
 *   interface language" (anonymous visitors always follow it). The server
 *   resolves it during SSR and hands it over in `useState`, so hydration
 *   renders the same card names — no mismatch.
 * - `cardLocale`: the choice, else the interface language.
 * - `change(next)`: `PATCH /api/profile { cardLocale }` first (a failure
 *   throws and nothing switches), then the state (every card name switches
 *   at once), then `refreshNuxtData()` so lists the server sorted by name
 *   come back in the new order.
 */
export function useCardLocale() {
  const { locale } = useUiLocale()
  const choice = useState<AppLocale | null>(CARD_LOCALE_CHOICE_STATE, () => null)
  const { data: ownProfile } = useNuxtData<OwnProfile | null>('own-profile')

  const cardLocale = computed<AppLocale>(() => choice.value ?? locale.value)

  async function change(next: AppLocale | null): Promise<void> {
    const updated = await $fetch<OwnProfile>('/api/profile', {
      method: 'PATCH',
      body: { cardLocale: next },
    })
    if (ownProfile.value) {
      ownProfile.value = updated
    }
    choice.value = next
    // Not awaited: the names switch right away; the data follows.
    void refreshNuxtData()
  }

  return { choice: readonly(choice), cardLocale, change }
}
