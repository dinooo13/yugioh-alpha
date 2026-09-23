import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { acceptConfirm } from './helpers/confirm'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const POT_OF_GREED = 55144522

async function pickScope(page: Page, option: string | RegExp) {
  await page.getByRole('combobox', { name: 'Sammlung', exact: true }).click()
  await page.getByRole('option', { name: option }).click()
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

    // Back to all cards, assign Dark Magician to Box 1.
    await pickScope(page, /^Alle Sammlungen/)
    await expect(page).toHaveURL(/\/inventory$/)
    await expect(heading).toHaveText('Alle Karten')
    await page.getByRole('combobox', { name: 'Sammlung für Dark Magician' }).click()
    await page.getByRole('option', { name: 'Box 1', exact: true }).click()

    // Liste scoped to Box 1: only its rows.
    await pickScope(page, 'Box 1 (2)')
    await expect(heading).toHaveText('Box 1')
    await expect(page.getByRole('combobox', { name: 'Sammlung für Dark Magician' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Sammlung für Pot of Greed' })).toHaveCount(0)

    // Übersicht keeps the same scope.
    await page.getByRole('button', { name: 'Übersicht' }).click()
    await expect(page).toHaveURL(/view=overview/)
    await expect(page).toHaveURL(/collectionId=/)
    await expect(page.getByLabel('Dark Magician vergrößern')).toBeVisible()
    await expect(page.getByLabel('Pot of Greed vergrößern')).toHaveCount(0)

    // "(keine Sammlung)": only the unassigned card, in both views.
    await pickScope(page, /^\(keine Sammlung\)/)
    await expect(heading).toHaveText('Ohne Sammlung')
    await expect(page).toHaveURL(/view=overview/)
    await expect(page.getByLabel('Pot of Greed vergrößern')).toBeVisible()
    await expect(page.getByLabel('Dark Magician vergrößern')).toHaveCount(0)
    await page.getByRole('button', { name: 'Liste' }).click()
    await expect(page).not.toHaveURL(/view=/)
    await expect(page.getByRole('combobox', { name: 'Sammlung für Pot of Greed' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Sammlung für Dark Magician' })).toHaveCount(0)

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
    await expect(anonymousPage.getByText('Dark Magician').first()).toBeVisible()
    await anonymous.close()

    // Delete: back to all cards, the cards stay.
    await openCollectionMenu(page, 'Binder', 'Löschen')
    await acceptConfirm(page)
    await expect(page).toHaveURL('/inventory')
    await expect(heading).toHaveText('Alle Karten')
    await expect(page.getByRole('combobox', { name: 'Sammlung für Dark Magician' })).toBeVisible()
  })

  test('"In Liste bearbeiten" opens the card\'s rows in Liste (#32)', async ({ page }) => {
    await registerAndLogin(page)
    for (const [cardId, quantity] of [[DARK_MAGICIAN, 2], [POT_OF_GREED, 1]]) {
      const response = await page.request.post('/api/inventory', { data: { catalog_card_id: cardId, quantity } })
      expect(response.ok()).toBe(true)
    }

    await page.goto('/inventory')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Übersicht' }).click()
    await expect(page).toHaveURL(/view=overview/)
    await page.getByLabel('Dark Magician vergrößern').click()
    await page.getByRole('dialog').getByRole('button', { name: 'In Liste bearbeiten' }).click()

    await expect(page).toHaveURL(new RegExp(`card=${DARK_MAGICIAN}`))
    await expect(page).not.toHaveURL(/view=/)
    const listeToggle = page.getByRole('button', { name: 'Liste', exact: true })
    await expect(listeToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Nur: Dark Magician')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Sammlung für Dark Magician' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Sammlung für Pot of Greed' })).toHaveCount(0)

    // Nothing flips the view back once the search debounce has passed.
    await page.waitForTimeout(500)
    await expect(listeToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(new RegExp(`card=${DARK_MAGICIAN}`))

    // Back returns to the Übersicht.
    await page.goBack()
    await expect(page).toHaveURL(/view=overview/)
    await expect(page.getByLabel('Dark Magician vergrößern')).toBeVisible()
  })
})
