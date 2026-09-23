import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

async function expectSkipLinkWorks(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')

  // The skip link is the very first stop in the tab order and only shows up
  // once it has focus.
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Zum Inhalt springen' })
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()
  const box = await skipLink.boundingBox()
  expect(box!.width, `${path}: skip link should be visible while focused`).toBeGreaterThan(40)

  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
}

test.describe('accessibility basics', () => {
  test('a skip link moves keyboard focus to the main content in the app and the public layout', async ({ page }) => {
    await registerAndLogin(page)
    const profile = await (await page.request.get('/api/profile')).json() as { handle: string }

    await expectSkipLinkWorks(page, '/decks')
    await expectSkipLinkWorks(page, `/spieler/${profile.handle}`)
  })

  test('compact icon buttons are 44px touch targets on phones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)

    const deckResponse = await page.request.post('/api/decks', { data: { name: 'Test Deck' } })
    expect(deckResponse.ok()).toBe(true)

    await page.goto('/decks')
    await page.waitForLoadState('networkidle')

    for (const name of ['Optionen für Test Deck', 'Menü öffnen']) {
      const box = await page.getByRole('button', { name }).boundingBox()
      expect(box, name).not.toBeNull()
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44)
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44)
    }
  })
})
