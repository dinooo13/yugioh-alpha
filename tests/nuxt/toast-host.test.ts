// Toasts stay reachable while a modal is open (#148): they render into a
// body-level `[aria-live]` host, which reka's `hideOthers` never hides.
import { afterEach, describe, expect, it } from 'vitest'
import { ensureToastHost, TOAST_HOST_ID } from '~/utils/toast-host'

afterEach(() => {
  document.getElementById(TOAST_HOST_ID)?.remove()
})

describe('ensureToastHost', () => {
  it('creates one silent host at the end of <body>, outside the app', () => {
    document.getElementById(TOAST_HOST_ID)?.remove()

    const host = ensureToastHost()

    expect(host.parentElement).toBe(document.body)
    expect(host.getAttribute('aria-live')).toBe('off')
    expect(ensureToastHost()).toBe(host)
    expect(document.querySelectorAll(`#${TOAST_HOST_ID}`)).toHaveLength(1)
  })
  // That reka's modal keeps it in the accessibility tree is covered end to
  // end: e2e/catalog-overlay.spec.ts finds the toast's link by role over
  // the open overlay.
})
