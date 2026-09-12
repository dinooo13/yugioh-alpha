import { expect, test } from '@playwright/test'

test.describe('protected routes', () => {
  test('visiting the dashboard unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /inventar unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/inventar')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /inventar/erfassen unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/inventar/erfassen')
    await expect(page).toHaveURL(/\/login\?redirect=\/inventar\/erfassen/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /profil unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/profil')
    await expect(page).toHaveURL(/\/login\?redirect=\/profil/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  test('visiting /wunschliste unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/wunschliste')
    await expect(page).toHaveURL(/\/login\?redirect=\/wunschliste/)
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  })

  // Regression guard for the auth middleware's PUBLIC_PREFIXES change
  // (app/middleware/auth.global.ts): /spieler/** must render — with its own
  // not-found copy for an unknown handle — instead of redirecting to /login.
  test('visiting an unknown /spieler/:handle unauthenticated does not redirect', async ({ page }) => {
    await page.goto('/spieler/gibt-es-nicht')
    await expect(page).toHaveURL('/spieler/gibt-es-nicht')
    await expect(page.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()
  })
})
