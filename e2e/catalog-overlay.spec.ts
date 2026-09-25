import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

// The catalog's card overlay (#148): `?card=` history like the inventory's,
// "Zum Deck", and a grid that stays while a search loads.

// Passcode from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

async function searchCatalog(page: Page, text: string) {
  const searched = page.waitForResponse(response =>
    response.url().includes(`/api/catalog/cards?q=${encodeURIComponent(text.split(' ')[0]!)}`))
  await page.getByLabel('Karten suchen').fill(text)
  await searched
}

async function deckQuantity(page: Page, deckId: string): Promise<number | undefined> {
  const response = await page.request.get(`/api/decks/${deckId}`)
  const deck = await response.json() as { sections: { main: Array<{ catalogCardId: number, quantity: number }> } }
  return deck.sections.main.find(row => row.catalogCardId === DARK_MAGICIAN)?.quantity
}

test.describe('catalog card overlay', () => {
  test('Back closes the overlay, Forward opens it again (#148)', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/')
    await waitForHydration(page)
    await page.goto('/catalog')
    await waitForHydration(page)
    await searchCatalog(page, 'Dark Magician')

    await page.getByRole('button', { name: CARD.darkMagician, exact: true }).click()
    const detail = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(detail).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`card=${DARK_MAGICIAN}`))

    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/catalog\?q=Dark/)
    await expect(page).not.toHaveURL(/card=/)

    await page.goForward()
    await expect(detail).toBeVisible()

    // Closing goes back to the entry without the card: still the catalog…
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(page).toHaveURL(/\/catalog\?q=Dark/)
    await expect(page).not.toHaveURL(/card=/)
    // …and no duplicate entry is left: Back leaves the catalog.
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)

    // A deep link closes onto the catalog itself.
    await page.goto(`/catalog?card=${DARK_MAGICIAN}`)
    await waitForHydration(page)
    await expect(detail).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(page).toHaveURL(/\/catalog$/)
  })

  test('"Zum Deck" adds a copy and links to the deck (#148)', async ({ page }) => {
    await registerAndLogin(page)
    const created = await page.request.post('/api/decks', { data: { name: 'Katalog-Deck' } })
    expect(created.ok()).toBe(true)
    const deckId = (await created.json() as { id: string }).id

    await page.goto(`/catalog?card=${DARK_MAGICIAN}`)
    await waitForHydration(page)
    const detail = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(detail).toBeVisible()

    for (const expected of [1, 2]) {
      await detail.getByRole('button', { name: 'Zum Deck' }).click()
      await page.getByRole('menuitem', { name: 'Katalog-Deck' }).click()
      const saved = page.waitForResponse(response =>
        response.request().method() === 'PUT' && response.url().includes(`/api/decks/${deckId}/cards`))
      await page.getByRole('menuitem', { name: 'Main Deck' }).click()
      expect((await saved).ok()).toBe(true)

      await expect(page.getByText('Zu „Katalog-Deck“ hinzugefügt').first()).toBeVisible()
      await expect(page.getByText(`${CARD.darkMagician}: jetzt ${expected}× im Main Deck.`, { exact: true })).toBeVisible()
      expect(await deckQuantity(page, deckId)).toBe(expected)
    }

    // The open overlay hides the toasts from the accessibility tree (reka's
    // modal), so the action is found by its text.
    await page.getByText('Deck öffnen').first().click()
    await expect(page).toHaveURL(`/decks/${deckId}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Katalog-Deck' })).toBeVisible()
    // Closing the overlay on the way out doesn't navigate back to the catalog.
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(`/decks/${deckId}`)
  })

  test('the grid stays, dimmed, while a search loads (#148)', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/catalog')
    await waitForHydration(page)
    await searchCatalog(page, 'Dark Magician')
    const tile = page.getByRole('button', { name: CARD.darkMagician, exact: true })
    await expect(tile).toBeVisible()

    // Hold the next search back until the checks below are done.
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/catalog/cards?q=Kuriboh*', async (route) => {
      await released
      await route.continue()
    })

    const searched = page.waitForResponse(response => response.url().includes('/api/catalog/cards?q=Kuriboh'))
    await page.getByLabel('Karten suchen').fill('Kuriboh')
    const results = page.getByTestId('catalog-results')
    await expect(results).toHaveAttribute('aria-busy', 'true')
    await expect(tile).toBeVisible()

    release()
    await searched
    await expect(results).not.toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('button', { name: CARD.kuriboh, exact: true })).toBeVisible()
    await expect(tile).toHaveCount(0)
  })
})
