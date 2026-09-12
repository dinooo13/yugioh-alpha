import type { Page } from '@playwright/test'

/**
 * Accepts the themed `useConfirm()` dialog (UX review #14) that replaced
 * every native `window.confirm` in the app — the confirm button's
 * accessible name is always "Bestätigen" unless the caller passed a custom
 * `confirmLabel`, and every call site in this app leaves it at the default.
 */
export async function acceptConfirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bestätigen' }).click()
}

/** Dismisses the themed confirm dialog via its "Abbrechen" button. */
export async function cancelConfirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Abbrechen' }).click()
}
