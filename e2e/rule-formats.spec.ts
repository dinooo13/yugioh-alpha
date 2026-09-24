import { expect, test } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { acceptConfirm } from './helpers/confirm'
import { CARD } from './helpers/cards'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414 // TCG 2002-03-08
const STARDUST_DRAGON = 44508094 // TCG 2008-09-02
const POT_OF_GREED = 55144522 // TCG 2002-03-08, Forbidden on the TCG banlist

test.describe('rule formats', () => {
  test('validates a deck live against a custom and a built-in format', async ({ page }) => {
    await registerAndLogin(page)

    // Seed the inventory through the API — `page.request` shares the page's
    // session cookie, so this is the same authenticated user.
    for (const catalogCardId of [DARK_MAGICIAN, STARDUST_DRAGON, POT_OF_GREED]) {
      const response = await page.request.post('/api/inventory', {
        data: { catalog_card_id: catalogCardId, quantity: 3 },
      })
      expect(response.ok()).toBe(true)
    }

    // --- Create a custom format --------------------------------------------
    await page.goto('/formats')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Offizielle Formate' })).toBeVisible()
    await expect(page.getByText('Noch keine eigenen Formate')).toBeVisible()

    await page.getByRole('link', { name: 'Neues Format' }).first().click()
    await expect(page).toHaveURL('/formats/new')

    await page.getByLabel('Formatname').fill('Nur alte Karten')

    // A main deck of at least one card (so the deck can be legal at all).
    await page.getByRole('button', { name: 'Regel hinzufügen: Deckgröße' }).click()
    await page.getByLabel('Mindestanzahl').fill('1')
    await page.getByLabel('Höchstanzahl').fill('60')
    await expect(page.getByText('Main Deck: 1–60 Karten')).toBeVisible()

    // Everything released after 2005 is forbidden.
    await page.getByRole('button', { name: 'Regel hinzufügen: Kartenfilter' }).click()
    await page.getByLabel('Filterrichtung').click()
    await page.getByRole('option', { name: 'Karten, auf die der Filter nicht passt' }).click()
    await page.getByLabel('Erschienen vor').fill('2006-01-01')
    await expect(page.getByText('Karten ohne erschienen vor dem 01.01.2006 (TCG): verboten')).toBeVisible()

    // Pot of Greed is forbidden by name, picked through the card search.
    await page.getByRole('button', { name: 'Regel hinzufügen: Einzelne Karten' }).click()
    await page.getByLabel('Karte für die Regel suchen').fill('Pot of Greed')
    await page.getByRole('button', { name: CARD.potOfGreed }).click()
    await expect(page.getByText(`Verboten: ${CARD.potOfGreed}`)).toBeVisible()

    await page.getByRole('button', { name: 'Format erstellen' }).click()
    await expect(page).toHaveURL('/formats')
    await expect(page.getByRole('heading', { name: 'Nur alte Karten' })).toBeVisible()

    // --- Build a deck ------------------------------------------------------
    await page.goto('/decks')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Neues Deck' }).first().click()
    await page.getByLabel('Deckname').fill('Format-Test')
    await page.getByRole('button', { name: 'Erstellen' }).click()

    await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/)
    const deckUrl = new URL(page.url()).pathname

    const search = page.getByLabel('Karten für das Deck suchen')
    const mainCount = page.getByLabel('Anzahl im Main Deck')

    await search.fill('Dark Magician')
    await page.getByRole('button', { name: `${CARD.darkMagician} zum Main Deck hinzufügen`, exact: true }).click()
    await expect(mainCount).toHaveText('1/40–60')

    await search.fill('Stardust')
    await page.getByRole('button', { name: `${CARD.stardustDragon} zum Extra Deck hinzufügen`, exact: true }).click()
    await expect(page.getByLabel('Anzahl im Extra Deck')).toHaveText('1/15')

    await search.fill('Pot of Greed')
    await page.getByRole('button', { name: `${CARD.potOfGreed} zum Main Deck hinzufügen`, exact: true }).click()
    await expect(mainCount).toHaveText('2/40–60')

    // --- Assign the custom format ------------------------------------------
    const status = page.getByLabel('Regelprüfung Status')
    await expect(status).toHaveText('Kein Format gewählt')

    await page.getByLabel('Format').click()
    await page.getByRole('option', { name: 'Nur alte Karten (eigenes)' }).click()

    await expect(status).toContainText('Nicht legal')
    await expect(page.getByText(`${CARD.stardustDragon} ist in diesem Format verboten.`)).toBeVisible()
    await expect(page.getByText(`${CARD.potOfGreed} ist in diesem Format verboten.`)).toBeVisible()

    // The offending rows are badged in the deck list.
    const potRow = page.getByRole('listitem').filter({ hasText: CARD.potOfGreed }).first()
    await expect(potRow.getByText('Verboten')).toBeVisible()

    // --- Remove the offending cards ----------------------------------------
    await page.getByRole('button', { name: `${CARD.potOfGreed} aus dem Main Deck entfernen`, exact: true }).click()
    await expect(mainCount).toHaveText('1/40–60')
    await page.getByRole('button', { name: `${CARD.stardustDragon} aus dem Extra Deck entfernen`, exact: true }).click()

    await expect(status).toHaveText('Legal')

    // --- Switch to a built-in format ---------------------------------------
    await page.getByLabel('Format').click()
    await page.getByRole('option', { name: 'TCG Advanced', exact: true }).click()

    await expect(status).toContainText('Nicht legal')
    // Correct German plural (UX review #10): "1 Karte", not "1 Karten".
    await expect(page.getByText('Das Main Deck hat 1 Karte, mindestens 40 sind erforderlich.')).toBeVisible()

    // --- The deck list shows format and legality ---------------------------
    await page.goto('/decks')
    const deckCard = page.getByRole('listitem').filter({ hasText: 'Format-Test' })
    await expect(deckCard.getByText('TCG Advanced')).toBeVisible()
    await expect(deckCard.getByText('Nicht legal')).toBeVisible()

    // --- Delete the custom format ------------------------------------------
    await page.goto('/formats')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Offizielle Formate' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Meine Formate' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'TCG Advanced' })).toBeVisible()

    await page.getByRole('button', { name: 'Nur alte Karten löschen' }).click()
    await acceptConfirm(page)
    await expect(page.getByText('Noch keine eigenen Formate')).toBeVisible()

    // The deck survives; it just lost its format assignment.
    await page.goto(deckUrl)
    await expect(page.getByRole('heading', { name: 'Format-Test' })).toBeVisible()
    await expect(page.getByLabel('Anzahl im Main Deck')).toHaveText('1/40–60')
  })

  test('keeps built-in formats read-only but clonable', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/formats/goat')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'GOAT Format' })).toBeVisible()
    await expect(page.getByText('Offizielle Banliste (GOAT)')).toBeVisible()
    await expect(page.getByText('Nur Karten bis Juni 2005')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Regel hinzufügen: Banliste' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Klonen' }).click()
    await expect(page).toHaveURL(/\/formats\/[0-9a-f-]{36}$/)
    await expect(page.getByLabel('Formatname')).toHaveValue('GOAT Format (Kopie)')

    // The clone is editable and lands in "Meine Formate".
    await page.getByLabel('Formatname').fill('Mein GOAT')
    await page.getByRole('button', { name: 'Speichern' }).click()

    await expect(page).toHaveURL('/formats')
    await expect(page.getByRole('heading', { name: 'Mein GOAT' })).toBeVisible()
  })
})
