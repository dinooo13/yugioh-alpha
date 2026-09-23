/**
 * Sets the document title to "<page> – yugioh alpha" in the active
 * interface language (`app.pageTitle`). Pass a message key; the title
 * follows a language switch.
 */
export function usePageTitle(pageKey: string | (() => string)) {
  const { t } = useI18n()
  useHead({
    title: () => t('app.pageTitle', { page: typeof pageKey === 'function' ? pageKey() : t(pageKey) }),
  })
}
