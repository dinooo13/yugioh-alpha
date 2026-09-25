import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { loginViaForm, logout, registerAndLogin, trackHydrationWarnings, waitForHydration } from './helpers/auth'

// Interface language (#34 F2, ADR 0014): the switch, the `ui_locale` cookie,
// the profile setting, and SSR rendering the chosen language without a
// hydration mismatch.

/** Picks a language in a LayoutLocaleSwitch (a Nuxt UI ULocaleSelect). */
async function pickLanguage(page: Page, currentLabel: 'Anzeigesprache' | 'Interface language', language: 'Deutsch' | 'English') {
  await page.getByRole('button', { name: currentLabel }).click()
  await page.getByRole('option', { name: language }).click()
}

async function uiLocaleCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies()
  return cookies.find(cookie => cookie.name === 'ui_locale')?.value
}

test.describe('interface language', () => {
  test('an anonymous visitor switches the login page to English and back', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)

    await page.goto('/login')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.getByText(/YGO Alpha ist ein inoffizielles Fanprojekt/)).toBeVisible()

    await pickLanguage(page, 'Anzeigesprache', 'English')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page).toHaveTitle('Sign in – YGO Alpha')
    await expect(page.getByText(/YGO Alpha is an unofficial fan project/)).toBeVisible()
    expect(await uiLocaleCookie(page)).toBe('en')

    // The server renders the cookie's language on the next page load.
    await page.reload()
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await pickLanguage(page, 'Interface language', 'Deutsch')
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    expect(await uiLocaleCookie(page)).toBe('de')

    expect(warnings).toEqual([])
  })

  test('a signed-in user picks English on the profile page and keeps it across navigations and reloads', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)
    await registerAndLogin(page)

    await page.goto('/profile')
    await waitForHydration(page)
    const sidebar = page.getByRole('complementary')
    await expect(sidebar.getByRole('link', { name: 'Inventar' })).toBeVisible()

    const saved = page.waitForResponse(response =>
      response.url().endsWith('/api/profile') && response.request().method() === 'PATCH')
    await pickLanguage(page, 'Anzeigesprache', 'English')
    expect((await saved).ok()).toBe(true)

    await expect(sidebar.getByRole('link', { name: 'Inventory' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()

    // Client-side navigation keeps the language.
    await sidebar.getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL('/inventory')
    await expect(sidebar.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await sidebar.getByRole('link', { name: 'Profile' }).click()
    await expect(page).toHaveURL('/profile')
    await expect(sidebar.getByRole('link', { name: 'Inventory' })).toBeVisible()

    await page.reload()
    await waitForHydration(page)
    await expect(sidebar.getByRole('link', { name: 'Inventory' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    expect(warnings).toEqual([])
  })

  test('the profile language beats a German cookie after signing in again', async ({ page, context, baseURL }) => {
    const warnings = trackHydrationWarnings(page)
    const user = await registerAndLogin(page)

    await page.goto('/profile')
    await waitForHydration(page)
    await pickLanguage(page, 'Anzeigesprache', 'English')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('complementary').getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/login')

    await context.addCookies([{ name: 'ui_locale', value: 'de', url: baseURL! }])
    await page.goto('/login')
    await loginViaForm(page, user)

    await expect(page).toHaveURL('/')
    await waitForHydration(page)
    const sidebar = page.getByRole('complementary')
    await expect(sidebar.getByRole('link', { name: 'Inventory' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await uiLocaleCookie(page)).toBe('en')

    // Back to German for the helpers' German selectors.
    await page.goto('/profile')
    await pickLanguage(page, 'Interface language', 'Deutsch')
    await expect(sidebar.getByRole('link', { name: 'Inventar' })).toBeVisible()
    await logout(page)

    expect(warnings).toEqual([])
  })

  test('an English browser gets the English UI without any cookie (Accept-Language, #34 F2d)', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    const warnings = trackHydrationWarnings(page)

    await page.goto('/login')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page).toHaveTitle('Sign in – YGO Alpha')
    // Detection alone sets no cookie; only picking a language does.
    expect((await context.cookies()).some(cookie => cookie.name === 'ui_locale')).toBe(false)

    // A cookie beats the header.
    await pickLanguage(page, 'Interface language', 'Deutsch')
    await page.reload()
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()

    expect(warnings).toEqual([])
    await context.close()
  })

  test('a context created with browser.newContext() keeps the project\'s German locale', async ({ browser }) => {
    // Several specs open a second context this way; they must stay German
    // now that Accept-Language is detected.
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await context.close()
  })
})
