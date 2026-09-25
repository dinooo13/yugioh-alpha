import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

// Owner feedback in #148: the deck header counts the card kinds, and the
// card overlay in the deck editor edits the card's quantity per section
// (no printings).
const DARK_MAGICIAN = 46986414
const KURIBOH = 40640057
const POT_OF_GREED = 55144522
const MIRROR_FORCE = 44095762
const STARDUST_DRAGON = 44508094
const UTOPIA = 84013237

async function createDeck(page: Page): Promise<string> {
  const response = await page.request.post('/api/decks', {
    data: {
      name: 'Overlay-Mengen',
      cards: [
        { catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 1 },
        { catalog_card_id: KURIBOH, section: 'main', quantity: 1 },
        { catalog_card_id: POT_OF_GREED, section: 'main', quantity: 2 },
        { catalog_card_id: MIRROR_FORCE, section: 'main', quantity: 1 },
        { catalog_card_id: STARDUST_DRAGON, section: 'extra', quantity: 1 },
        { catalog_card_id: UTOPIA, section: 'extra', quantity: 1 },
      ],
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()).id
}

async function openRowOverlay(page: Page, name: string, section: string) {
  const row = page.locator('main li').filter({ has: page.getByRole('spinbutton', { name: `Anzahl von ${name} im ${section}` }) })
  await row.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name })
  await expect(dialog.getByRole('heading', { name: 'Kartentext', level: 3 })).toBeVisible()
  return dialog
}

test.describe('deck editor card overlay and card-kind breakdown', () => {
  test('the header breakdown and the overlay\'s per-section quantities', async ({ page }) => {
    await registerAndLogin(page)
    const deckId = await createDeck(page)

    await page.goto(`/decks/${deckId}`)
    await waitForHydration(page)

    const breakdown = page.getByTestId('deck-breakdown')
    for (const chip of ['1 Normales Monster', '1 Effektmonster', '2 Zauberkarten', '1 Fallenkarte', '1 Synchro', '1 Xyz']) {
      await expect(breakdown).toContainText(chip)
    }

    // A Main Deck card: Main and Side, no printings.
    const dialog = await openRowOverlay(page, CARD.darkMagician, 'Main Deck')
    await expect(dialog.getByText('Printings')).toHaveCount(0)
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Main Deck' })).toHaveValue('1')
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Side Deck' })).toHaveValue('0')
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Extra Deck' })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Eine Kopie mehr im Main Deck' }).click()
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Main Deck' })).toHaveValue('2')
    await dialog.getByRole('button', { name: 'Eine Kopie mehr im Side Deck' }).click()
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Side Deck' })).toHaveValue('1')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('spinbutton', { name: `Anzahl von ${CARD.darkMagician} im Main Deck` })).toHaveValue('2')
    await expect(page.getByLabel('Anzahl im Main Deck')).toHaveText('6/40–60')
    await expect(page.getByLabel('Anzahl im Side Deck')).toHaveText('1/15')
    await expect(breakdown).toContainText('2 Normale Monster')

    // An Extra Deck monster: Extra and Side, no Main.
    const extra = await openRowOverlay(page, CARD.stardustDragon, 'Extra Deck')
    await expect(extra.getByRole('spinbutton', { name: 'Kopien im Extra Deck' })).toHaveValue('1')
    await expect(extra.getByRole('spinbutton', { name: 'Kopien im Side Deck' })).toHaveValue('0')
    await expect(extra.getByRole('spinbutton', { name: 'Kopien im Main Deck' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(extra).toBeHidden()
  })

  test('a keyboard step keeps focus on its button while the write is in flight', async ({ page }) => {
    await registerAndLogin(page)
    const deckId = await createDeck(page)

    await page.goto(`/decks/${deckId}`)
    await waitForHydration(page)
    const dialog = await openRowOverlay(page, CARD.darkMagician, 'Main Deck')

    const plus = dialog.getByRole('button', { name: 'Eine Kopie mehr im Main Deck' })
    await plus.focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Main Deck' })).toHaveValue('2')
    // Nothing is disabled while the write is queued (#148), so the focus stays.
    await expect(plus).toBeEnabled()
    await expect(plus).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('spinbutton', { name: 'Kopien im Main Deck' })).toHaveValue('3')
  })

  test('a row stepper queues fast keyboard steps and keeps the focus (#148)', async ({ page }) => {
    await registerAndLogin(page)
    const deckId = await createDeck(page)

    await page.goto(`/decks/${deckId}`)
    await waitForHydration(page)

    const plus = page.getByRole('button', { name: `Eine Kopie von ${CARD.darkMagician} zum Main Deck hinzufügen` })
    await plus.focus()
    // Three steps without waiting for any answer: 2, 3, 4 go out in order.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('spinbutton', { name: `Anzahl von ${CARD.darkMagician} im Main Deck` })).toHaveValue('4')
    await expect(plus).toBeFocused()
    await expect(page.getByLabel('Anzahl im Main Deck')).toHaveText('8/40–60')

    await page.reload()
    await waitForHydration(page)
    await expect(page.getByRole('spinbutton', { name: `Anzahl von ${CARD.darkMagician} im Main Deck` })).toHaveValue('4')
  })

  test('the add panel searches the card text on request (#148)', async ({ page }) => {
    await registerAndLogin(page)
    const deckId = await createDeck(page)

    await page.goto(`/decks/${deckId}`)
    await waitForHydration(page)

    await page.getByRole('checkbox', { name: 'Auch Katalogkarten anzeigen' }).check()
    // "Hexer" is only in Dark Magician's German card text, not in a name.
    await page.getByLabel('Karten für das Deck suchen').fill('Hexer')
    await expect(page.getByText('Keine Karten gefunden.')).toBeVisible()

    await page.getByRole('checkbox', { name: 'Auch im Kartentext suchen' }).check()
    await expect(page.getByRole('button', { name: `${CARD.darkMagician} zum Main Deck hinzufügen` })).toBeVisible()
  })

  test('the deck tiles show the compact card kinds (#148)', async ({ page }) => {
    await registerAndLogin(page)
    await createDeck(page)

    await page.goto('/decks')
    await waitForHydration(page)

    const kinds = page.getByRole('list', { name: 'Kartenarten im Main und Extra Deck' })
    for (const chip of ['1 Normal', '1 Effekt', '2 Zauber', '1 Falle', '1 Synchro', '1 Xyz']) {
      await expect(kinds).toContainText(chip)
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(kinds).toBeVisible()
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })

  test('the breakdown fits a 390px phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)
    const deckId = await createDeck(page)

    await page.goto(`/decks/${deckId}`)
    await waitForHydration(page)

    await expect(page.getByTestId('deck-breakdown')).toBeVisible()
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })
})
