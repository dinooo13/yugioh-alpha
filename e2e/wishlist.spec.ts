import { expect, test } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

test.describe('wishlist', () => {
  test('add a card from the catalog, manage it, and share it publicly', async ({ page, browser }) => {
    await registerAndLogin(page)
    const profile = await (await page.request.get('/api/profile')).json()

    await page.goto('/catalog')
    await waitForHydration(page)
    // Wait for the debounced search: while it loads, the card grid is
    // replaced by skeletons, so the tile lookup below would hit a vanishing
    // tile. (A toggle that finishes meanwhile is no longer lost, #98.)
    const searched = page.waitForResponse(response => response.url().includes('/api/catalog/cards?q=Kuriboh'))
    await page.getByLabel('Karten suchen').fill('Kuriboh')
    await searched

    // Scope to the card tile (an `<article aria-label="<name>">`, see
    // app/pages/catalog.vue) — "Zur Wunschliste" itself is not unique
    // across cards.
    const kuribohCard = page.getByLabel(CARD.kuriboh, { exact: true })
    await expect(kuribohCard).toBeVisible()

    await kuribohCard.getByRole('button', { name: 'Zur Wunschliste' }).click()
    await expect(kuribohCard.getByRole('button', { name: 'Auf der Wunschliste' })).toBeVisible()

    await page.getByRole('link', { name: 'Wunschliste' }).click()
    await expect(page).toHaveURL('/wishlist')
    await expect(page.getByText(CARD.kuriboh)).toBeVisible()

    // The wishlist's own visibility is now shown on the page itself, not
    // just on /profile (UX review #22); it starts private.
    await expect(page.getByText('Privat', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sichtbarkeit ändern' })).toBeVisible()

    // Quantity starts at 1 — the minus button must not pretend it can go
    // any lower (UX review #25).
    await expect(page.getByRole('button', { name: `Ein Exemplar von ${CARD.kuriboh} entfernen` })).toBeDisabled()

    // Quantity starts at 1 from the catalog toggle; bump it to 3.
    const addOne = page.getByRole('button', { name: `Ein Exemplar von ${CARD.kuriboh} hinzufügen` })
    await addOne.click()
    await addOne.click()
    await expect(page.getByLabel(`Anzahl von ${CARD.kuriboh}`)).toHaveText('3')

    const noteInput = page.getByLabel(`Notiz für ${CARD.kuriboh}`)
    await noteInput.fill('1st Edition bitte')
    await noteInput.blur()

    // Both the quantity and the note persist across a reload.
    await page.reload()
    await expect(page.getByLabel(`Anzahl von ${CARD.kuriboh}`)).toHaveText('3')
    await expect(page.getByLabel(`Notiz für ${CARD.kuriboh}`)).toHaveValue('1st Edition bitte')

    // Publish the wishlist and check it from an anonymous context.
    await page.goto('/profile')
    await waitForHydration(page)
    await page.getByLabel('Wunschliste öffentlich zeigen').click()
    // Same "Gespeichert" feedback as the profile form above it — previously
    // this switch gave no confirmation at all (UX review #22).
    await expect(page.getByText('Gespeichert').last()).toBeVisible()

    await page.goto('/wishlist')
    await expect(page.getByText('Öffentlich', { exact: true })).toBeVisible()

    const anonContext = await browser.newContext()
    const anonPage = await anonContext.newPage()
    await anonPage.goto(`/players/${profile.handle}`)
    await expect(anonPage.getByRole('heading', { name: 'Wunschliste' })).toBeVisible()
    await expect(anonPage.getByText(CARD.kuriboh)).toBeVisible()
    await expect(anonPage.getByText('3×')).toBeVisible()
    await anonContext.close()

    // Remove it again — the list goes back to its empty state.
    await page.goto('/wishlist')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Entfernen', exact: true }).click()
    await expect(page.getByText('Noch keine Karten auf der Wunschliste.')).toBeVisible()
  })
})
