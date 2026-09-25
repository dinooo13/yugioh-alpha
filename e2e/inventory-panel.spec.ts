import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'
import { acceptConfirm, cancelConfirm } from './helpers/confirm'

// The inventory's detail panel (#135): the same editable overlay from a
// "Galerie" tile and from a "Liste" row. Every change is saved at once.
// `?card=` opens it, Back closes it (#145).

// Passcode from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

interface OwnedRow {
  id: string
  collectionId: string | null
  quantity: number
  note: string | null
}

async function createCollection(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/collections', { data: { name } })
  expect(response.ok()).toBe(true)
  return (await response.json() as { id: string }).id
}

async function addCopies(page: Page, data: { collection_id?: string, quantity: number, note?: string }) {
  const response = await page.request.post('/api/inventory', { data: { catalog_card_id: DARK_MAGICIAN, ...data } })
  expect(response.ok()).toBe(true)
}

async function ownedRows(page: Page): Promise<OwnedRow[]> {
  const response = await page.request.get(`/api/inventory?catalogCardId=${DARK_MAGICIAN}`)
  return (await response.json() as { items: OwnedRow[] }).items
}

function inventoryWrite(page: Page, method: string) {
  return page.waitForResponse(response => response.request().method() === method && response.url().includes('/api/inventory'))
}

function cardButton(page: Page) {
  return page.getByRole('button', { name: CARD.darkMagician, exact: true })
}

test.describe('inventory detail panel', () => {
  test('from the gallery: step, type and move the copies; they stay after a reload', async ({ page }) => {
    await registerAndLogin(page)
    const boxId = await createCollection(page, 'Box 1')
    await addCopies(page, { quantity: 2 })

    await page.goto('/inventory?view=gallery')
    await waitForHydration(page)
    await cardButton(page).click()

    const panel = page.getByRole('dialog', { name: CARD.darkMagician })
    const quantity = panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })
    await expect(quantity).toHaveValue('2')

    let saved = inventoryWrite(page, 'PATCH')
    await panel.getByRole('button', { name: 'Eine Kopie mehr in (keine Sammlung)' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(quantity).toHaveValue('3')

    saved = inventoryWrite(page, 'PATCH')
    await quantity.fill('5')
    await quantity.press('Tab')
    expect((await saved).ok()).toBe(true)

    saved = inventoryWrite(page, 'PATCH')
    await panel.getByRole('combobox', { name: 'Sammlung ändern (jetzt: (keine Sammlung))' }).click()
    await page.getByRole('option', { name: 'Box 1', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in Box 1' })).toHaveValue('5')

    // The panel is in the URL (#145): a reload opens it again.
    await page.reload()
    await waitForHydration(page)
    const reopened = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(reopened.getByRole('combobox', { name: 'Sammlung ändern (jetzt: Box 1)' })).toBeVisible()
    await expect(reopened.getByRole('spinbutton', { name: 'Anzahl in Box 1' })).toHaveValue('5')
    expect(await ownedRows(page)).toMatchObject([{ collectionId: boxId, quantity: 5 }])
  })

  test('from the list: the row is highlighted; moving it merges the copies and keeps both notes', async ({ page }) => {
    await registerAndLogin(page)
    const boxId = await createCollection(page, 'Box 1')
    await addCopies(page, { collection_id: boxId, quantity: 2, note: 'vorne' })
    await addCopies(page, { quantity: 1, note: 'hinten' })

    await page.goto('/inventory')
    await waitForHydration(page)

    // Two rows, each with its collection, the attribute and the German text.
    await expect(cardButton(page)).toHaveCount(2)
    const boxRow = page.locator('main li').filter({ hasText: 'Box 1' })
    const looseRow = page.locator('main li').filter({ hasText: '(keine Sammlung)' })
    for (const row of [boxRow, looseRow]) {
      await expect(row.getByText('FINSTERNIS')).toBeVisible()
      await expect(row.getByTestId('card-text-excerpt')).toContainText('Der ultimative Hexer')
    }

    await boxRow.getByRole('button', { name: CARD.darkMagician, exact: true }).click()
    const panel = page.getByRole('dialog', { name: CARD.darkMagician })
    const focused = panel.locator('[data-focused]')
    await expect(focused.getByRole('combobox', { name: 'Sammlung ändern (jetzt: Box 1)' })).toBeVisible()
    await expect(panel.getByRole('spinbutton')).toHaveCount(2)

    const saved = inventoryWrite(page, 'PATCH')
    await focused.getByRole('combobox', { name: 'Sammlung ändern (jetzt: Box 1)' }).click()
    await page.getByRole('option', { name: '— (keine)', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByText('Mit den Kopien in (keine Sammlung) zusammengelegt.').first()).toBeVisible()
    await expect(panel.getByRole('spinbutton')).toHaveCount(1)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toHaveValue('3')

    // A reload keeps the panel open (#145); closing it shows the list.
    await page.reload()
    await waitForHydration(page)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toHaveValue('3')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(cardButton(page)).toHaveCount(1)
    const merged = page.locator('main li').filter({ has: cardButton(page) })
    await expect(merged).toContainText('×3')
    // The target's note first (ADR 0017's merge, like migration 0014).
    await expect(merged.locator('p[title]')).toHaveAttribute('title', 'hinten\nvorne')
    expect(await ownedRows(page)).toMatchObject([{ collectionId: null, quantity: 3, note: 'hinten\nvorne' }])
  })

  test('adds the card to another collection and removes copies after asking', async ({ page }) => {
    await registerAndLogin(page)
    await createCollection(page, 'Box 1')
    await addCopies(page, { quantity: 1 })

    await page.goto('/inventory')
    await waitForHydration(page)
    await cardButton(page).click()
    const panel = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toHaveValue('1')

    const added = inventoryWrite(page, 'POST')
    await panel.getByRole('button', { name: 'Zu Sammlung hinzufügen' }).click()
    await page.getByRole('menuitem', { name: 'Box 1' }).click()
    expect((await added).ok()).toBe(true)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in Box 1' })).toHaveValue('1')
    // In every collection now: nothing left to add to.
    await expect(panel.getByRole('button', { name: 'Zu Sammlung hinzufügen' })).toHaveCount(0)

    const removed = inventoryWrite(page, 'DELETE')
    await panel.getByRole('button', { name: 'Aus Box 1 entfernen' }).click()
    await acceptConfirm(page)
    expect((await removed).ok()).toBe(true)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in Box 1' })).toHaveCount(0)

    // − at 1 asks too; cancelling keeps the copy.
    await panel.getByRole('button', { name: 'Eine Kopie weniger in (keine Sammlung)' }).click()
    await expect(page.getByRole('dialog', { name: 'Aus Sammlung entfernen' })).toContainText(`${CARD.darkMagician} aus (keine Sammlung) entfernen?`)
    await cancelConfirm(page)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toHaveValue('1')
    expect(await ownedRows(page)).toMatchObject([{ collectionId: null, quantity: 1 }])
  })

  test('keyboard: a row opens with Enter and gets the focus back on Escape', async ({ page }) => {
    await registerAndLogin(page)
    await addCopies(page, { quantity: 1 })

    await page.goto('/inventory')
    await waitForHydration(page)

    // Tab from the search field's neighbourhood onto the row button.
    const rowButton = cardButton(page)
    await page.getByRole('checkbox', { name: 'Auch im Kartentext suchen' }).focus()
    for (let i = 0; i < 20 && !await rowButton.evaluate(el => el === document.activeElement); i++) {
      await page.keyboard.press('Tab')
    }
    await expect(rowButton).toBeFocused()

    await page.keyboard.press('Enter')
    const panel = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(rowButton).toBeFocused()
  })

  test('deep link and Back (#145)', async ({ page }) => {
    await registerAndLogin(page)
    await addCopies(page, { quantity: 1 })

    await page.goto('/inventory')
    await waitForHydration(page)
    await cardButton(page).click()
    const panel = page.getByRole('dialog', { name: CARD.darkMagician })
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/inventory\\?card=${DARK_MAGICIAN}$`))

    // Back closes the panel, Forward opens it again.
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/inventory$/)
    await page.goForward()
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toBeVisible()

    // A deep link opens it; closing it drops the param without leaving the page.
    await page.goto(`/inventory?card=${DARK_MAGICIAN}`)
    await waitForHydration(page)
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/inventory$/)
  })

  test('the list filters by type, and stays the list (#145)', async ({ page }) => {
    await registerAndLogin(page)
    await addCopies(page, { quantity: 1 })
    const potOfGreed = await page.request.post('/api/inventory', { data: { catalog_card_id: 55144522, quantity: 1 } })
    expect(potOfGreed.ok()).toBe(true)

    await page.goto('/inventory')
    await waitForHydration(page)
    await expect(cardButton(page)).toHaveCount(1)
    await expect(page.getByRole('button', { name: CARD.potOfGreed, exact: true })).toHaveCount(1)

    const listed = page.waitForResponse(response => response.url().includes('/api/inventory?') && response.url().includes('type='))
    await page.getByRole('button', { name: 'Typ', exact: true }).click()
    await page.getByRole('option', { name: 'Zauberkarte', exact: true }).click()
    await listed
    await page.keyboard.press('Escape')

    await expect(page.getByRole('button', { name: CARD.potOfGreed, exact: true })).toHaveCount(1)
    await expect(cardButton(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/view=gallery/)
    await expect(page.getByRole('button', { name: 'Liste', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})
