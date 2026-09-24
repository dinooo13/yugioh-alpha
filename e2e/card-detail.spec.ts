import { expect, test } from '@playwright/test'
import { registerAndLogin, trackHydrationWarnings, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

// One card detail overlay for the catalog and the inventory (#88): the
// catalog adds printings and actions, the inventory what the user owns with
// the notes. No source credit for the German texts in the UI (#87).
// Every dialog lookup is by name: two dialogs can be open at once.

// Passcodes from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const KURIBOH = 40640057

test.describe('card detail overlay', () => {
  test('catalog: deep link, Escape and focus return', async ({ page }) => {
    const warnings = trackHydrationWarnings(page)
    await registerAndLogin(page)

    await page.goto(`/catalog?card=${DARK_MAGICIAN}`)
    await waitForHydration(page)

    const detail = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('heading', { name: 'Kartentext', level: 3 })).toBeVisible()
    await expect(detail.getByText('SDY-006')).toBeVisible()
    await expect(detail.getByText('Normales Monster', { exact: true })).toBeVisible()
    await expect(detail.getByText('FINSTERNIS', { exact: true })).toBeVisible()
    await expect(detail.getByText('2500', { exact: true })).toBeVisible()
    await expect(detail.getByText('Deutsche Kartentexte')).toHaveCount(0)
    await expect(detail.getByRole('link', { name: /yugioh-card-history/ })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(page).not.toHaveURL(/card=/)

    // From the grid: the tile's name button opens it, Escape returns focus there.
    const searched = page.waitForResponse(response => response.url().includes('/api/catalog/cards?q=Dark'))
    await page.getByLabel('Karten suchen').fill('Dark Magician')
    await searched
    const tileButton = page.getByRole('button', { name: CARD.darkMagician, exact: true })
    await tileButton.focus()
    await page.keyboard.press('Enter')
    await expect(detail).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`card=${DARK_MAGICIAN}`))

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(tileButton).toBeFocused()

    expect(warnings).toEqual([])
  })

  test('catalog: wishlist and "Zum Inventar" from the overlay', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/catalog')
    await waitForHydration(page)
    const searched = page.waitForResponse(response => response.url().includes('/api/catalog/cards?q=Kuriboh'))
    await page.getByLabel('Karten suchen').fill('Kuriboh')
    await searched
    await page.getByRole('button', { name: CARD.kuriboh, exact: true }).click()

    const detail = page.getByRole('dialog', { name: CARD.kuriboh })
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Zur Wunschliste' }).click()
    await expect(detail.getByRole('button', { name: 'Auf der Wunschliste' })).toBeVisible()

    // The tile reads the same state.
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    const tile = page.getByLabel(CARD.kuriboh, { exact: true })
    await expect(tile.getByRole('button', { name: 'Auf der Wunschliste' })).toBeVisible()

    // "Zum Inventar" opens the add dialog on top of the detail; Escape closes
    // only the add dialog and returns focus to the button.
    await page.getByRole('button', { name: CARD.kuriboh, exact: true }).click()
    await expect(detail).toBeVisible()
    const addButton = detail.getByRole('button', { name: 'Zum Inventar' })
    await addButton.click()
    const addDialog = page.getByRole('dialog', { name: 'Karte hinzufügen' })
    await expect(addDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(addDialog).toBeHidden()
    await expect(detail).toBeVisible()
    await expect(addButton).toBeFocused()

    await addButton.click()
    await expect(addDialog).toBeVisible()
    const saved = page.waitForResponse(response =>
      response.url().endsWith('/api/inventory') && response.request().method() === 'POST')
    await addDialog.getByRole('button', { name: 'Hinzufügen' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(addDialog).toBeHidden()
    await expect(detail).toBeVisible()

    const owned = await (await page.request.get(`/api/inventory?catalogCardId=${KURIBOH}`)).json() as { items: unknown[] }
    expect(owned.items).toHaveLength(1)
  })

  test('inventory: the owned copies with their note, and a way to the catalog', async ({ page }) => {
    await registerAndLogin(page)
    const created = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 2, note: 'Binder vorne' },
    })
    expect(created.ok()).toBe(true)

    await page.goto('/inventory?view=overview')
    await waitForHydration(page)
    await page.getByRole('button', { name: `${CARD.darkMagician} vergrößern` }).click()

    const detail = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('heading', { name: 'Kartentext', level: 3 })).toBeVisible()
    await expect(detail.getByRole('heading', { name: 'Im Inventar', level: 3 })).toBeVisible()
    await expect(detail.getByText('(keine Sammlung)')).toBeVisible()
    await expect(detail.getByText('×2', { exact: true })).toBeVisible()
    await expect(detail.getByText('Binder vorne')).toBeVisible()
    await expect(detail.getByText('SDY-006')).toHaveCount(0)
    await expect(detail.getByText('Printings')).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Zum Inventar' })).toHaveCount(0)

    await detail.getByRole('link', { name: 'Im Katalog öffnen' }).click()
    await expect(page).toHaveURL(`/catalog?card=${DARK_MAGICIAN}`)
    await expect(page.getByRole('dialog', { name: CARD.darkMagician }).getByText('SDY-006')).toBeVisible()
  })

  test('390px: one column, the card above the text, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)

    await page.goto(`/catalog?card=${DARK_MAGICIAN}`)
    await waitForHydration(page)
    const detail = page.getByRole('dialog', { name: CARD.darkMagician })
    const heading = detail.getByRole('heading', { name: 'Kartentext', level: 3 })
    await expect(heading).toBeVisible()
    await expect(detail.getByText('SDY-006')).toBeAttached()

    const overflow = await detail.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

    const imageBox = await detail.getByRole('img', { name: CARD.darkMagician }).boundingBox()
    const headingBox = await heading.boundingBox()
    expect(imageBox!.y).toBeLessThan(headingBox!.y)

    const documentOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(documentOverflow.clientWidth)
  })
})
