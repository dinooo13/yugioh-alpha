import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { acceptConfirm } from './helpers/confirm'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const STARDUST_DRAGON = 44508094
const ODD_EYES_PENDULUM_DRAGON = 16178681
const BLUE_EYES_ULTIMATE_DRAGON = 23995346

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
    await expect(deckCard.getByText('1 fehlt im Besitz')).toBeVisible()

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

    await page.getByRole('button', { name: 'Optionen für Test Deck' }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await acceptConfirm(page)

    await expect(page.getByText('Noch keine Decks')).toBeVisible()
  })
})

test.describe('deckbuilder on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the add panel below the deck and collapsible', async ({ page }) => {
    await registerAndLogin(page)

    const response = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 2 },
    })
    expect(response.ok()).toBe(true)

    await page.goto('/decks')
    await page.getByRole('button', { name: 'Neues Deck' }).first().click()
    await page.getByLabel('Deckname').fill('Handy Deck')
    await page.getByRole('button', { name: 'Erstellen' }).click()
    await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/)

    // An empty deck opens with the add panel expanded.
    const search = page.getByLabel('Karten für das Deck suchen')
    const mainCount = page.getByLabel('Anzahl im Main Deck')
    const addDarkMagician = page.getByRole('button', { name: 'Dark Magician zum Main Deck hinzufügen', exact: true })
    await expect(search).toBeVisible()

    await search.fill('Dark Magician')
    await addDarkMagician.click()
    await expect(mainCount).toHaveText('1/40–60')

    // Once the deck has cards, the panel starts collapsed on a phone.
    await page.reload()
    await expect(mainCount).toHaveText('1/40–60')
    await expect(search).toBeHidden()

    // The header shortcut opens it again.
    await page.getByRole('button', { name: 'Karten hinzufügen', exact: true }).click()
    await expect(search).toBeVisible()

    await search.fill('Dark Magician')
    await addDarkMagician.click()
    await expect(mainCount).toHaveText('2/40–60')

    await page.getByRole('button', { name: 'Ausblenden', exact: true }).click()
    await expect(search).toBeHidden()
  })

  test('renames and deletes the deck from the "Weitere Aktionen" menu', async ({ page }) => {
    await registerAndLogin(page)

    const response = await page.request.post('/api/decks', { data: { name: 'Menü Deck' } })
    expect(response.ok()).toBe(true)
    const deck = await response.json() as { id: string }

    await page.goto(`/decks/${deck.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Menü Deck')

    await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Umbenennen' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Deckname').fill('Umbenanntes Deck')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Umbenanntes Deck')

    await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await acceptConfirm(page)
    await expect(page).toHaveURL('/decks')
  })
})

test.describe('deckbuilder at 1024px', () => {
  // The `lg` breakpoint: the sidebar and the sticky add panel both take their
  // width here, which used to squeeze the title to "Cyb…" (#40).
  test.use({ viewport: { width: 1024, height: 768 } })

  test('keeps the deck name and card names readable and pages the add panel', async ({ page }) => {
    await registerAndLogin(page)

    const deckName = 'Cyber Dragon Infinity Kontrolle Deck'
    const response = await page.request.post('/api/decks', {
      data: {
        name: deckName,
        cards: [
          { catalog_card_id: ODD_EYES_PENDULUM_DRAGON, section: 'main', quantity: 1 },
          { catalog_card_id: BLUE_EYES_ULTIMATE_DRAGON, section: 'extra', quantity: 1 },
        ],
      },
    })
    expect(response.ok()).toBe(true)
    const deck = await response.json() as { id: string }

    await page.goto(`/decks/${deck.id}`)

    // The title shows in full — no ellipsis.
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(deckName)
    expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

    // Card names get real width and are not clipped.
    for (const cardName of ['Odd-Eyes Pendulum Dragon', 'Blue-Eyes Ultimate Dragon']) {
      const nameLine = page.locator(`p[title="${cardName}"]`)
      await expect(nameLine).toHaveText(cardName)
      const box = await nameLine.boundingBox()
      expect(box!.width, `${cardName} width`).toBeGreaterThanOrEqual(150)
      expect(
        await nameLine.evaluate(element => element.scrollHeight <= element.clientHeight + 1),
        `${cardName} clipped`,
      ).toBe(true)
    }

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(horizontalOverflow).toBeLessThanOrEqual(0)

    await expect(page.getByRole('button', { name: 'Teilen' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Weitere Aktionen' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Format' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Karten hinzufügen', exact: true })).toBeHidden()

    // --- "Mehr laden" in the add panel (#31) ----------------------------------
    await page.getByRole('checkbox', { name: 'Auch Katalogkarten anzeigen' }).click()
    const countLine = page.getByText(/^\s*12 von \d+ Karten\s*$/)
    await expect(countLine).toBeVisible()
    const total = Number((await countLine.textContent())!.match(/von (\d+)/)![1])

    await page.getByRole('button', { name: 'Mehr laden' }).click()
    // Alphabetically the 14th fixture card, i.e. on page 2.
    await expect(page.getByRole('button', { name: 'Summoned Skull zum Main Deck hinzufügen', exact: true })).toBeVisible()
    if (total <= 24) {
      await expect(page.getByRole('button', { name: 'Mehr laden' })).toHaveCount(0)
    }
  })
})
