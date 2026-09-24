import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { CARD } from './helpers/cards'

// Passcode from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

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
    await expectSkipLinkWorks(page, `/players/${profile.handle}`)
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

  test('the deck editor row controls and add buttons are 44px touch targets on phones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 1 },
    })
    expect(inventoryResponse.ok()).toBe(true)
    const deckResponse = await page.request.post('/api/decks', {
      data: { name: 'Tap Deck', cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 1 }] },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json() as { id: string }

    await page.goto(`/decks/${deck.id}`)
    await page.waitForLoadState('networkidle')

    const expectTapTarget = async (name: string) => {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(box, name).not.toBeNull()
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44)
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44)
    }

    for (const name of [
      `Eine Kopie von ${CARD.darkMagician} aus dem Main Deck entfernen`,
      `Eine Kopie von ${CARD.darkMagician} zum Main Deck hinzufügen`,
      `Optionen für ${CARD.darkMagician}`,
      `${CARD.darkMagician} aus dem Main Deck entfernen`,
      'Weitere Aktionen',
    ]) {
      await expectTapTarget(name)
    }

    await page.getByRole('button', { name: 'Karten hinzufügen', exact: true }).click()
    await expect(page.getByRole('button', { name: `${CARD.darkMagician} zum Main Deck hinzufügen`, exact: true })).toBeVisible()
    await expectTapTarget(`${CARD.darkMagician} zum Main Deck hinzufügen`)
  })
})
