import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

// Passcode from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

/**
 * UX review #1 (blocker): a fixed 256px sidebar with no responsive handling
 * pushed page content out of a 390px viewport. Verifies the fix directly —
 * no horizontal scrolling on the pages the review measured, a hamburger
 * button instead of the sidebar, and the mobile nav drawer actually works.
 */
test.describe('responsive layout at 390px', () => {
  test('no horizontal scrolling on inventar, deck editor, tournament detail, or katalog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)

    // Seed a deck and a tournament so their detail pages are reachable.
    const deckResponse = await page.request.post('/api/decks', {
      data: { name: 'Mobile-Test-Deck', cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 1 }] },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json() as { id: string }

    const tournamentResponse = await page.request.post('/api/tournaments', { data: { name: 'Mobile-Test-Turnier' } })
    expect(tournamentResponse.ok()).toBe(true)
    const tournament = await tournamentResponse.json() as { id: string }

    const routes = ['/inventar', `/decks/${deck.id}`, `/turniere/${tournament.id}`, '/katalog']

    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')

      // The desktop sidebar is `hidden` below `lg`; the hamburger takes its place.
      await expect(page.getByRole('button', { name: 'Menü öffnen' })).toBeVisible()

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth, `${route} should not scroll horizontally at 390px`).toBeLessThanOrEqual(clientWidth)
    }
  })

  test('hamburger opens a drawer with navigation and the user block', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)
    await page.goto('/inventar')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Menü öffnen' }).click()
    const drawer = page.getByRole('dialog', { name: 'Menü' })
    await expect(drawer.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Abmelden' })).toBeVisible()

    // Navigating closes the drawer again instead of leaving it stuck open.
    await drawer.getByRole('link', { name: 'Decks' }).click()
    await expect(page).toHaveURL('/decks')
    await expect(page.getByRole('dialog', { name: 'Menü' })).toHaveCount(0)
  })
})
