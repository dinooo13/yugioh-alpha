import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { acceptConfirm } from './helpers/confirm'
import { CARD } from './helpers/cards'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const POT_OF_GREED = 55144522

async function pickScope(page: Page, option: string | RegExp) {
  await page.getByRole('combobox', { name: 'Sammlung', exact: true }).click()
  await page.getByRole('option', { name: option }).click()
}

// A card's row ("Liste") or tile ("Galerie"): its name is the button.
function cardButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
}

async function openCollectionMenu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: `Optionen für ${name}` }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test.describe('collections on the inventory page', () => {
  test('create, assign, filter both views, rename, share and delete a collection', async ({ page, browser }) => {
    await registerAndLogin(page)
    for (const [cardId, quantity] of [[DARK_MAGICIAN, 2], [POT_OF_GREED, 1]]) {
      const response = await page.request.post('/api/inventory', { data: { catalog_card_id: cardId, quantity } })
      expect(response.ok()).toBe(true)
    }

    await page.goto('/inventory')
    await page.waitForLoadState('networkidle')

    // The sidebar is plain navigation now (#41).
    await expect(page.locator('aside')).not.toContainText('Neue Sammlung')
    await expect(page.locator('aside')).not.toContainText('SAMMLUNGEN')

    const heading = page.getByRole('heading', { level: 1 })
    const pageHeader = page.locator('main header')

    // Create "Box 1" — it becomes the active scope.
    await page.getByRole('button', { name: 'Neue Sammlung' }).click()
    const createDialog = page.getByRole('dialog')
    await createDialog.getByLabel('Name', { exact: true }).fill('Box 1')
    await createDialog.getByRole('button', { name: 'Erstellen' }).click()
    await expect(page).toHaveURL(/[?&]collectionId=/)
    await expect(heading).toHaveText('Box 1')
    await expect(pageHeader.getByText('0 Karten', { exact: true })).toBeVisible()

    // Back to all cards, assign Dark Magician to Box 1 in its detail panel (#135).
    await pickScope(page, /^Alle Sammlungen/)
    await expect(page).toHaveURL(/\/inventory$/)
    await expect(heading).toHaveText('Alle Karten')
    await cardButton(page, CARD.darkMagician).click()
    const panel = page.getByRole('dialog')
    const moved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/api/inventory/'))
    await panel.getByRole('combobox', { name: 'Sammlung ändern (jetzt: (keine Sammlung))' }).click()
    await page.getByRole('option', { name: 'Box 1', exact: true }).click()
    expect((await moved).ok()).toBe(true)
    await expect(panel.getByRole('combobox', { name: 'Sammlung ändern (jetzt: Box 1)' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Liste scoped to Box 1: only its rows.
    await pickScope(page, 'Box 1 (2)')
    await expect(heading).toHaveText('Box 1')
    await expect(cardButton(page, CARD.darkMagician)).toBeVisible()
    await expect(cardButton(page, CARD.potOfGreed)).toHaveCount(0)

    // Galerie keeps the same scope.
    await page.getByRole('button', { name: 'Galerie' }).click()
    await expect(page).toHaveURL(/view=gallery/)
    await expect(page).toHaveURL(/collectionId=/)
    await expect(page.locator('article').getByRole('button', { name: CARD.darkMagician, exact: true })).toBeVisible()
    await expect(cardButton(page, CARD.potOfGreed)).toHaveCount(0)

    // "(keine Sammlung)": only the unassigned card, in both views.
    await pickScope(page, /^\(keine Sammlung\)/)
    await expect(heading).toHaveText('Ohne Sammlung')
    await expect(page).toHaveURL(/view=gallery/)
    await expect(page.locator('article').getByRole('button', { name: CARD.potOfGreed, exact: true })).toBeVisible()
    await expect(cardButton(page, CARD.darkMagician)).toHaveCount(0)
    await page.getByRole('button', { name: 'Liste' }).click()
    await expect(page).not.toHaveURL(/view=/)
    await expect(page.locator('li').getByRole('button', { name: CARD.potOfGreed, exact: true })).toBeVisible()
    await expect(cardButton(page, CARD.darkMagician)).toHaveCount(0)

    // Rename.
    await pickScope(page, 'Box 1 (2)')
    await openCollectionMenu(page, 'Box 1', 'Umbenennen')
    const renameDialog = page.getByRole('dialog')
    await renameDialog.getByLabel('Name', { exact: true }).fill('Binder')
    await renameDialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(heading).toHaveText('Binder')

    // Share publicly; the header shows the visibility badge.
    await openCollectionMenu(page, 'Binder', 'Teilen')
    await page.getByRole('radio', { name: 'Öffentlich' }).click()
    await expect(page.getByRole('radio', { name: 'Öffentlich' })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pageHeader.getByText('Öffentlich', { exact: true })).toBeVisible()

    // A public collection opens for anyone at the profile path.
    const { handle } = await (await page.request.get('/api/profile')).json()
    const collectionId = new URL(page.url()).searchParams.get('collectionId')
    const publicUrl = new URL(`/players/${handle}/collections/${collectionId}`, page.url()).toString()
    const anonymous = await browser.newContext()
    const anonymousPage = await anonymous.newPage()
    await anonymousPage.goto(publicUrl)
    await expect(anonymousPage.getByRole('heading', { name: 'Binder' })).toBeVisible()
    await expect(anonymousPage.getByText(CARD.darkMagician).first()).toBeVisible()
    await anonymous.close()

    // Delete: back to all cards, the cards stay.
    await openCollectionMenu(page, 'Binder', 'Löschen')
    await acceptConfirm(page)
    await expect(page).toHaveURL('/inventory')
    await expect(heading).toHaveText('Alle Karten')
    await expect(cardButton(page, CARD.darkMagician)).toBeVisible()
  })
})
