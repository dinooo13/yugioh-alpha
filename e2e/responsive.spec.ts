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
  test('no horizontal scrolling on inventar, decks, deck editor, tournament detail, katalog, own profile, or a custom format', async ({ page }) => {
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

    // An owned card so /inventar renders real list rows, not just the empty state.
    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 1 },
    })
    expect(inventoryResponse.ok()).toBe(true)
    const tournament = await tournamentResponse.json() as { id: string }

    // A filter rule with several (long) card types selected: the multi-select
    // used to grow to its content width (~2360px) and push the page sideways.
    const formatResponse = await page.request.post('/api/formats', {
      data: {
        name: 'Mobile-Test-Format',
        rules: {
          rules: [{
            kind: 'filter',
            match: 'not_matching',
            maxCopies: 0,
            filter: {
              types: [
                'Pendulum Effect Fusion Monster',
                'XYZ Pendulum Effect Monster',
                'Synchro Pendulum Effect Monster',
                'Pendulum Tuner Effect Monster',
                'Pendulum Normal Monster',
                'Link Monster',
              ],
            },
          }],
        },
      },
    })
    expect(formatResponse.ok()).toBe(true)
    const format = await formatResponse.json() as { id: string }

    const profile = await (await page.request.get('/api/profile')).json() as { handle: string }

    // `/spieler/**` uses the slim public layout — no sidebar, so no hamburger.
    const routes: Array<{ path: string, appShell: boolean }> = [
      { path: '/inventar', appShell: true },
      { path: '/decks', appShell: true },
      { path: `/decks/${deck.id}`, appShell: true },
      { path: `/turniere/${tournament.id}`, appShell: true },
      { path: '/katalog', appShell: true },
      { path: `/formate/${format.id}`, appShell: true },
      { path: `/spieler/${profile.handle}`, appShell: false },
    ]

    for (const { path: route, appShell } of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')

      if (appShell) {
        // The desktop sidebar is `hidden` below `lg`; the hamburger takes its place.
        await expect(page.getByRole('button', { name: 'Menü öffnen' })).toBeVisible()
      }

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth, `${route} should not scroll horizontally at 390px`).toBeLessThanOrEqual(clientWidth)
    }
  })

  // UX feedback: the "Liste" table collapsed its name column to 0px at 390px
  // and both views cropped the card art. Measures CSS boxes only — images are
  // hotlinked, so their natural size isn't reliable in CI.
  test('inventar Liste und Übersicht sind bei 390px nutzbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    await page.goto('/inventar')
    await page.waitForLoadState('networkidle')

    // Liste (default view)
    const name = page.getByText('Dark Magician', { exact: true }).first()
    await expect(name).toBeVisible()
    const nameBox = await name.boundingBox()
    expect(nameBox!.width).toBeGreaterThanOrEqual(100)

    await expect(page.getByRole('combobox', { name: 'Sammlung für Dark Magician' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Karte bearbeiten' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Karte entfernen' })).toBeVisible()

    const thumbnailBox = await page.getByRole('img', { name: 'Dark Magician' }).first().boundingBox()
    expect(thumbnailBox).not.toBeNull()
    expect(thumbnailBox!.width / thumbnailBox!.height).toBeGreaterThan(0.686 - 0.03)
    expect(thumbnailBox!.width / thumbnailBox!.height).toBeLessThan(0.686 + 0.03)

    const listOverflow = await page.locator('ul:has([aria-label="Sammlung für Dark Magician"])').evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(listOverflow.scrollWidth).toBeLessThanOrEqual(listOverflow.clientWidth)

    const documentOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(documentOverflow.clientWidth)

    // Übersicht
    await page.getByRole('button', { name: 'Übersicht' }).click()
    const tile = page.getByRole('button', { name: 'Dark Magician vergrößern' })
    await expect(tile).toBeVisible()
    const tileBox = await tile.boundingBox()
    expect(tileBox!.width).toBeGreaterThanOrEqual(150)
    await expect(page.getByText('×3 ges.')).toBeVisible()

    await tile.click()
    const preview = page.getByRole('dialog')
    await expect(preview.getByRole('link', { name: 'Im Katalog öffnen' })).toBeVisible()
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
