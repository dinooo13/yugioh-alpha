import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const STARDUST_DRAGON = 44508094

test.describe('deckbuilder', () => {
  test('builds a deck from owned cards and tracks availability', async ({ page }) => {
    await registerAndLogin(page)

    // Seed the inventory through the API — `page.request` shares the page's
    // session cookie, so this is the same authenticated user.
    for (const [catalogCardId, quantity] of [[DARK_MAGICIAN, 2], [STARDUST_DRAGON, 1]] as const) {
      const response = await page.request.post('/api/inventory', {
        data: { catalog_card_id: catalogCardId, quantity },
      })
      expect(response.ok()).toBe(true)
    }

    // --- Create a deck ------------------------------------------------------
    await page.goto('/decks')
    await expect(page.getByText('Noch keine Decks')).toBeVisible()

    await page.getByRole('button', { name: 'Neues Deck' }).first().click()
    await page.getByLabel('Deckname').fill('Test Deck')
    await page.getByRole('button', { name: 'Erstellen' }).click()

    await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'Test Deck' })).toBeVisible()

    const mainCount = page.getByLabel('Anzahl im Main Deck')
    const extraCount = page.getByLabel('Anzahl im Extra Deck')
    await expect(mainCount).toHaveText('0/40–60')

    // --- Add 3× Dark Magician while owning only 2 ---------------------------
    await page.getByLabel('Karten für das Deck suchen').fill('Dark Magician')
    const addDarkMagician = page.getByRole('button', { name: 'Dark Magician zum Main Deck hinzufügen', exact: true })

    await addDarkMagician.click()
    await expect(mainCount).toHaveText('1/40–60')
    await addDarkMagician.click()
    await expect(mainCount).toHaveText('2/40–60')
    await addDarkMagician.click()
    await expect(mainCount).toHaveText('3/40–60')

    // Availability: 3 used, 2 owned.
    const shortfall = page.getByTitle('Du besitzt nur 2')
    await expect(shortfall).toBeVisible()
    await expect(shortfall).toHaveText('3/2')

    // --- An Extra Deck monster cannot go into the Main Deck -----------------
    await page.getByLabel('Karten für das Deck suchen').fill('Stardust')
    await expect(page.getByRole('button', { name: 'Stardust Dragon zum Main Deck hinzufügen', exact: true })).toBeDisabled()

    await page.getByRole('button', { name: 'Stardust Dragon zum Extra Deck hinzufügen', exact: true }).click()
    await expect(extraCount).toHaveText('1/15')
    await expect(mainCount).toHaveText('3/40–60')
    await expect(page.getByText('4 Karten insgesamt')).toBeVisible()

    // An undersized main deck is a warning, not an error.
    await expect(page.getByText('Das Main Deck hat 3 Karten', { exact: false })).toBeVisible()

    // --- Back to the list ---------------------------------------------------
    await page.getByRole('link', { name: 'Zurück zu den Decks' }).click()
    await expect(page).toHaveURL('/decks')

    const deckCard = page.getByRole('listitem').filter({ hasText: 'Test Deck' })
    await expect(deckCard).toContainText('Main')
    await expect(deckCard).toContainText('Extra')
    await expect(deckCard).toContainText('4 Karten')
    await expect(deckCard.getByText('1 fehlt')).toBeVisible()

    // --- Search by a contained card -----------------------------------------
    const deckSearch = page.getByLabel('Decks durchsuchen')

    // Start from a term that matches nothing, so finding the deck by a card
    // name afterwards is a real state change rather than an unfiltered list.
    await deckSearch.fill('zzz')
    await expect(page.getByText('Keine Decks gefunden')).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Test Deck' })).toHaveCount(0)

    // "Stardust" is not part of the deck name — it only matches a card in it.
    await deckSearch.fill('Stardust')
    await expect(page.getByRole('listitem').filter({ hasText: 'Test Deck' })).toBeVisible()
    await expect(page.getByText('Keine Decks gefunden')).toHaveCount(0)

    // --- Delete the deck ----------------------------------------------------
    // Reload instead of clearing the search box: a pending debounced refresh
    // would re-render the list under the open dropdown.
    await page.goto('/decks')
    await expect(page.getByRole('listitem').filter({ hasText: 'Test Deck' })).toBeVisible()

    page.on('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Optionen für Test Deck' }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()

    await expect(page.getByText('Noch keine Decks')).toBeVisible()
  })
})
