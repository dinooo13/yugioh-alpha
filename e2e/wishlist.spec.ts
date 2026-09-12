import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

test.describe('wishlist', () => {
  test('add a card from the catalog, manage it, and share it publicly', async ({ page, browser }) => {
    await registerAndLogin(page)
    const profile = await (await page.request.get('/api/profile')).json()

    await page.goto('/katalog')
    await page.getByLabel('Karten suchen').fill('Kuriboh')

    // Scope to the card tile (each has `role="button" aria-label="<name>"`,
    // see app/pages/katalog.vue) — "Zur Wunschliste" itself is not unique
    // across cards.
    const kuribohCard = page.getByLabel('Kuriboh', { exact: true })
    await expect(kuribohCard).toBeVisible()

    await kuribohCard.getByRole('button', { name: 'Zur Wunschliste' }).click()
    await expect(kuribohCard.getByRole('button', { name: 'Auf der Wunschliste' })).toBeVisible()

    await page.getByRole('link', { name: 'Wunschliste' }).click()
    await expect(page).toHaveURL('/wunschliste')
    await expect(page.getByText('Kuriboh')).toBeVisible()

    // Quantity starts at 1 from the catalog toggle; bump it to 3.
    const addOne = page.getByRole('button', { name: 'Ein Exemplar von Kuriboh hinzufügen' })
    await addOne.click()
    await addOne.click()
    await expect(page.getByLabel('Anzahl von Kuriboh')).toHaveText('3')

    const noteInput = page.getByLabel('Notiz für Kuriboh')
    await noteInput.fill('1st Edition bitte')
    await noteInput.blur()

    // Both the quantity and the note persist across a reload.
    await page.reload()
    await expect(page.getByLabel('Anzahl von Kuriboh')).toHaveText('3')
    await expect(page.getByLabel('Notiz für Kuriboh')).toHaveValue('1st Edition bitte')

    // Publish the wishlist and check it from an anonymous context.
    await page.goto('/profil')
    await page.getByLabel('Wunschliste öffentlich zeigen').click()

    const anonContext = await browser.newContext()
    const anonPage = await anonContext.newPage()
    await anonPage.goto(`/spieler/${profile.handle}`)
    await expect(anonPage.getByRole('heading', { name: 'Wunschliste' })).toBeVisible()
    await expect(anonPage.getByText('Kuriboh')).toBeVisible()
    await expect(anonPage.getByText('3×')).toBeVisible()
    await anonContext.close()

    // Remove it again — the list goes back to its empty state.
    await page.goto('/wunschliste')
    await page.getByRole('button', { name: 'Entfernen', exact: true }).click()
    await expect(page.getByText('Noch keine Karten auf der Wunschliste.')).toBeVisible()
  })
})
