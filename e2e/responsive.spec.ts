import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'
import { CARD } from './helpers/cards'

// Passcode from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

/**
 * UX review #1 (blocker): a fixed 256px sidebar with no responsive handling
 * pushed page content out of a 390px viewport. Verifies the fix directly —
 * no horizontal scrolling on the pages the review measured, a hamburger
 * button instead of the sidebar, and the mobile nav drawer actually works.
 */
test.describe('responsive layout at 390px', () => {
  test('no horizontal scrolling on the main app pages and the shared player views', async ({ page }) => {
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

    // An owned card so /inventory renders real list rows, not just the empty state.
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

    // `/players/**` uses the slim public layout — no sidebar, so no hamburger.
    const routes: Array<{ path: string, appShell: boolean }> = [
      { path: '/inventory', appShell: true },
      { path: '/decks', appShell: true },
      { path: `/decks/${deck.id}`, appShell: true },
      { path: `/tournaments/${tournament.id}`, appShell: true },
      { path: '/catalog', appShell: true },
      // Long multi-selections in the filter menus (#63) must truncate, not widen the page.
      { path: '/catalog?type=Normal%20Monster,Effect%20Monster,Synchro%20Monster,XYZ%20Monster&race=Spellcaster,Dragon&attribute=DARK,LIGHT,WIND&level=1,4,7,8', appShell: true },
      { path: `/formats/${format.id}`, appShell: true },
      { path: '/wishlist', appShell: true },
      { path: '/tournaments', appShell: true },
      { path: '/tournaments/new', appShell: true },
      { path: '/formats', appShell: true },
      { path: '/inventory/quick-entry', appShell: true },
      { path: `/players/${profile.handle}`, appShell: false },
      { path: `/players/${profile.handle}/inventory`, appShell: false },
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
  test('inventory Liste und Galerie sind bei 390px nutzbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    await page.goto('/inventory')
    await page.waitForLoadState('networkidle')

    // Liste (default view): the name is the row's button (#135).
    const name = page.getByRole('button', { name: CARD.darkMagician, exact: true })
    await expect(name).toBeVisible()
    const nameBox = await name.boundingBox()
    expect(nameBox!.width).toBeGreaterThanOrEqual(100)

    await expect(page.getByTestId('card-text-excerpt')).toBeVisible()
    await expect(page.locator('main li').getByText('(keine Sammlung)')).toBeVisible()

    const thumbnailBox = await page.getByRole('img', { name: CARD.darkMagician }).first().boundingBox()
    expect(thumbnailBox).not.toBeNull()
    expect(thumbnailBox!.width / thumbnailBox!.height).toBeGreaterThan(0.686 - 0.03)
    expect(thumbnailBox!.width / thumbnailBox!.height).toBeLessThan(0.686 + 0.03)

    const listOverflow = await page.locator(`ul:has(button:text-is("${CARD.darkMagician}"))`).evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(listOverflow.scrollWidth).toBeLessThanOrEqual(listOverflow.clientWidth)

    const documentOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(documentOverflow.clientWidth)

    // Galerie
    await page.getByRole('button', { name: 'Galerie' }).click()
    const tile = page.locator('article').filter({ has: page.getByRole('button', { name: CARD.darkMagician, exact: true }) })
    await expect(tile).toBeVisible()
    const tileBox = await tile.boundingBox()
    expect(tileBox!.width).toBeGreaterThanOrEqual(150)
    await expect(page.getByText('×3 ges.')).toBeVisible()

    // The detail panel: no horizontal scroll, touch-sized controls.
    await tile.getByRole('button', { name: CARD.darkMagician, exact: true }).click()
    const panel = page.getByRole('dialog')
    await expect(panel.getByRole('link', { name: 'Im Katalog öffnen' })).toBeVisible()
    await expect(panel.getByRole('spinbutton', { name: 'Anzahl in (keine Sammlung)' })).toHaveValue('3')
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)))
    for (const control of [
      panel.getByRole('button', { name: 'Eine Kopie weniger in (keine Sammlung)' }),
      panel.getByRole('button', { name: 'Eine Kopie mehr in (keine Sammlung)' }),
      panel.getByRole('button', { name: 'Aus (keine Sammlung) entfernen' }),
    ]) {
      const box = await control.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    const panelOverflow = await panel.evaluate((el) => {
      const scroller = el.querySelector('[data-slot="body"]') ?? el
      return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }
    })
    expect(panelOverflow.scrollWidth).toBeLessThanOrEqual(panelOverflow.clientWidth)
  })

  test('hamburger opens a drawer with navigation and the user block', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)
    await page.goto('/inventory')
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
