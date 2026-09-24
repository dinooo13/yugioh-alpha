/** The cookie @nuxtjs/color-mode stores the preference in (nuxt.config.ts). */
export const COLOR_MODE_COOKIE = 'ygo-color-mode'

/**
 * Whether the page is in dark mode (ADR 0016). @nuxtjs/color-mode resolves
 * the mode only on the client (from its inline script), so on the server
 * this reads the cookie itself: dark unless it says `light`. That keeps
 * mode-dependent markup (the toggle's icon and label, `<html class>`,
 * `theme-color`) identical between SSR and hydration.
 */
export function useIsDark() {
  const colorMode = useColorMode()
  const cookie = useCookie<string | null>(COLOR_MODE_COOKIE)

  const isDark = computed(() => import.meta.server
    ? cookie.value !== 'light'
    : colorMode.value !== 'light')

  function toggle() {
    colorMode.preference = isDark.value ? 'light' : 'dark'
  }

  return { isDark, toggle }
}
