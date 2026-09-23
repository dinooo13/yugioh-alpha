import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { loginViaForm, logout, registerAndLogin, trackHydrationWarnings } from './helpers/auth'

// Regression tests for #38 (hydration mismatch on the first page after
// login) and #39 (`/` rendering the login layout after login). The cause was
// the service worker answering the navigation to `/` with HTML it had cached
// while logged out. Pages are per-user SSR, so no navigation may ever come
// from the service worker, and the first page after login must hydrate
// against its own, server-rendered, logged-in HTML.

async function expectAppShell(page: Page) {
  const sidebar = page.getByRole('complementary')
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Abmelden' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toHaveCount(0)
}

/** Waits until the service worker controls the page, so its routes would apply to the next navigation. */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    }
  })
}

test.describe('first page after login', () => {
  test('renders the app shell from the server, not a cached login page', async ({ page }) => {
    const user = await registerAndLogin(page)
    await logout(page)
    await waitForServiceWorker(page)

    const warnings = trackHydrationWarnings(page)
    const dashboardResponse = page.waitForResponse(response =>
      response.request().isNavigationRequest() && new URL(response.url()).pathname === '/')
    await loginViaForm(page, user)
    const response = await dashboardResponse

    expect(response.fromServiceWorker()).toBe(false)
    await expect(page).toHaveURL('/')
    await page.waitForLoadState('networkidle')
    await expectAppShell(page)

    for (const path of ['/', '/inventar', '/decks']) {
      const navigation = await page.goto(path)
      expect(navigation?.fromServiceWorker()).toBe(false)
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(path)
      await expectAppShell(page)
    }

    expect(warnings).toEqual([])
  })

  test('returns to the originally requested page after login without hydration warnings', async ({ page }) => {
    const user = await registerAndLogin(page)
    await logout(page)

    const warnings = trackHydrationWarnings(page)
    await page.goto('/inventar')
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)inventar/)

    await loginViaForm(page, user)

    await expect(page).toHaveURL('/inventar')
    await page.waitForLoadState('networkidle')
    await expectAppShell(page)
    expect(warnings).toEqual([])
  })
})
