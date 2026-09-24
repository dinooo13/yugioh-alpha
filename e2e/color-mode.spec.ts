import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin, trackHydrationWarnings } from './helpers/auth'

// Dark-first color mode stored in a cookie, so the server renders the right
// `<html class>` and `theme-color` (docs/adr/0016-visual-design-system.md).

const DARK_THEME_COLOR = '#0a0a1a'
const LIGHT_THEME_COLOR = '#f3f2f8'

function htmlClassOf(html: string): string {
  return /<html[^>]*\sclass="([^"]*)"/.exec(html)?.[1] ?? ''
}

async function colorModeCookie(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find(cookie => cookie.name === 'ygo-color-mode')?.value
}

test.describe('color mode', () => {
  test('is dark by default, rendered by the server', async ({ page }) => {
    const html = await (await page.request.get('/login')).text()
    expect(htmlClassOf(html).split(' ')).toContain('dark')
    expect(html).toContain(`<meta name="theme-color" content="${DARK_THEME_COLOR}">`)

    await page.goto('/login')
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', DARK_THEME_COLOR)
  })

  test('the toggle switches to light, persists in a cookie, and the server renders it after a reload', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Zum hellen Modus wechseln' }).click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', LIGHT_THEME_COLOR)
    await expect.poll(() => colorModeCookie(page)).toBe('light')

    // The server now renders light straight away (no flash of dark).
    const html = await (await page.request.get('/login')).text()
    expect(htmlClassOf(html).split(' ')).toContain('light')
    expect(html).toContain(`<meta name="theme-color" content="${LIGHT_THEME_COLOR}">`)

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    // The toggle's label and icon hydrate for light mode, too.
    await expect(page.getByRole('button', { name: 'Zum dunklen Modus wechseln' })).toBeVisible()

    expect(warnings).toEqual([])
  })

  test('the sidebar toggle works in the app and survives navigation without hydration warnings', async ({ page }) => {
    await registerAndLogin(page)
    const warnings = trackHydrationWarnings(page)

    const sidebar = page.getByRole('complementary')
    await sidebar.getByRole('button', { name: 'Zum hellen Modus wechseln' }).click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    await expect.poll(() => colorModeCookie(page)).toBe('light')

    for (const path of ['/decks', '/inventory', '/']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/\blight\b/)
    }

    await sidebar.getByRole('button', { name: 'Zum dunklen Modus wechseln' }).click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', DARK_THEME_COLOR)
    await expect.poll(() => colorModeCookie(page)).toBe('dark')

    expect(warnings).toEqual([])
  })
})
