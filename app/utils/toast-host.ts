/** Where the toasts render (`UApp`'s `toaster.portal`, see plugins/toast-host.client.ts). */
export const TOAST_HOST_ID = 'toast-host'

/**
 * The toasts' home at the end of `<body>` (#148). An open modal hides
 * everything outside it from assistive tech (reka's `hideOthers`), except
 * `[aria-live]` elements: `aria-live="off"` keeps a toast's text and its
 * action ("Deck öffnen") reachable over an overlay without announcing
 * anything twice (reka announces toasts itself). It sits outside `#__nuxt`,
 * whose `isolation: isolate` would put the toasts under a modal's overlay.
 */
export function ensureToastHost(doc: Document = document): HTMLElement {
  const existing = doc.getElementById(TOAST_HOST_ID)
  if (existing) {
    return existing
  }
  const host = doc.createElement('div')
  host.id = TOAST_HOST_ID
  host.setAttribute('aria-live', 'off')
  doc.body.append(host)
  return host
}
