import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { loginViaForm, logout, registerAndLogin, trackHydrationWarnings, waitForHydration } from './helpers/auth'

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
    await waitForHydration(page)
    await expectAppShell(page)

    for (const path of ['/', '/inventory', '/decks']) {
      const navigation = await page.goto(path)
      expect(navigation?.fromServiceWorker()).toBe(false)
      await waitForHydration(page)
      await expect(page).toHaveURL(path)
      await expectAppShell(page)
    }

    expect(warnings).toEqual([])
  })

  test('returns to the originally requested page after login without hydration warnings', async ({ page }) => {
    const user = await registerAndLogin(page)
    await logout(page)

    const warnings = trackHydrationWarnings(page)
    await page.goto('/inventory')
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)inventory/)

    await loginViaForm(page, user)

    await expect(page).toHaveURL('/inventory')
    await waitForHydration(page)
    await expectAppShell(page)
    expect(warnings).toEqual([])
  })

  test('waitForHydration waits for the client bundle before typing', async ({ browser }) => {
    // Delay every client script so the server-rendered form stays unhydrated
    // for a while. No service worker, so nothing can bypass the delay.
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.route('**/_nuxt/**/*.js', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1500))
      await route.continue()
    })

    const start = Date.now()
    await page.goto('/login', { waitUntil: 'commit' })
    await waitForHydration(page)
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000)

    // Typed before hydration, the text stays in the DOM but never reaches
    // v-model, so the submit stops at "Bitte fülle alle Felder aus." instead
    // of sending the sign-in request.
    const signIn = page.waitForRequest(request => request.url().includes('/api/auth/sign-in/email'))
    await page.getByLabel('E-Mail').fill('nobody@example.com')
    await page.getByLabel('Passwort').fill('not-a-real-password')
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await signIn
    await expect(page.getByText('Bitte fülle alle Felder aus.')).toHaveCount(0)
    await context.close()
  })
})
