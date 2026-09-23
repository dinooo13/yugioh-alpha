import { expect, test } from '@playwright/test'

test.describe('protected routes', () => {
  test('visiting the dashboard unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /inventory unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/inventory')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /inventory/quick-entry unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/inventory/quick-entry')
    await expect(page).toHaveURL(/\/login\?redirect=\/inventory\/quick-entry/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /profile unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?redirect=\/profile/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /wishlist unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/wishlist')
    await expect(page).toHaveURL(/\/login\?redirect=\/wishlist/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  // Regression guard for the auth middleware's PUBLIC_PREFIXES change
  // (app/middleware/auth.global.ts): /players/** must render — with its own
  // not-found copy for an unknown handle — instead of redirecting to /login.
  test('visiting an unknown /players/:handle unauthenticated does not redirect', async ({ page }) => {
    await page.goto('/players/gibt-es-nicht')
    await expect(page).toHaveURL('/players/gibt-es-nicht')
    await expect(page.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()
  })

  // Old German share links (docs/adr/0013-english-url-scheme.md) are
  // redirected before the auth middleware, so they don't end at /login.
  test('an old /spieler/:handle link lands on /players/:handle unauthenticated', async ({ page }) => {
    await page.goto('/spieler/gibt-es-nicht')
    await expect(page).toHaveURL('/players/gibt-es-nicht')
    await expect(page.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()
  })
})
