import { resolveUiLocale } from '../utils/ui-locale'

/**
 * Installs the lazy per-request UI-language resolver (ADR 0014). Only the
 * SSR app plugin (app/plugins/ui-locale.ts) calls it, so API and asset
 * requests never pay for the session and profile lookup.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    event.context.resolveUiLocale = () => resolveUiLocale(event)
  })

  // The rendered HTML depends on the session / `ui_locale` cookie (and on
  // Accept-Language once detection is on), so tell caches about it.
  nitroApp.hooks.hook('render:response', (response) => {
    response.headers = { ...response.headers, vary: 'accept-language, cookie' }
  })
})
