import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD } from './helpers/cards'

/**
 * #134: whole cards are click targets (`stretched-link`), clickable things
 * show the pointer, and a select's open menu is as wide as its options.
 *
 * Clicking covered text needs `page.mouse.click` on its position: Playwright's
 * `locator.click()` refuses because the card's link "intercepts pointer
 * events" — which is exactly the point.
 */

async function clickCenterOf(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

test.describe('clickable cards (#134)', () => {
  test('dashboard: the card body opens the list, the quick action keeps its own target', async ({ page }) => {
    await registerAndLogin(page)

    const inventoryCard = page.locator('main article').filter({ has: page.getByRole('link', { name: 'Inventar', exact: true }) })
    await clickCenterOf(page, inventoryCard.locator('.lp-counter'))
    await expect(page).toHaveURL('/inventory')

    await page.goBack()
    await expect(page).toHaveURL('/')
    await inventoryCard.getByRole('link', { name: 'Karten erfassen' }).click()
    await expect(page).toHaveURL('/inventory/quick-entry')
  })

  test('deck list: the whole tile opens the deck, the options menu stays a menu', async ({ page }) => {
    await registerAndLogin(page)
    const name = 'Klick-Deck'
    const response = await page.request.post('/api/decks', { data: { name } })
    expect(response.ok()).toBe(true)
    const deck = await response.json() as { id: string }

    await page.goto('/decks')
    await waitForHydration(page)
    const tile = page.locator('main li').filter({ has: page.getByRole('link', { name }) })
    await clickCenterOf(page, tile.getByText('0 Karten', { exact: true }))
    await expect(page).toHaveURL(`/decks/${deck.id}`)

    await page.goto('/decks')
    await waitForHydration(page)
    await tile.getByRole('button', { name: `Optionen für ${name}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Umbenennen' })).toBeVisible()
    await expect(page).toHaveURL('/decks')
  })

  test('catalog: the tile button shows the pointer', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/catalog')
    await waitForHydration(page)

    const button = page.getByRole('button', { name: CARD.darkMagician, exact: true })
    await expect(button).toHaveCSS('cursor', 'pointer')
  })

  test('select menus grow to fit a long option without cutting it or scrolling the page', async ({ page }) => {
    await registerAndLogin(page)
    const longName = 'Ein sehr langes Turnierformat mit Sonderregeln für den lokalen Spieleabend 2026'
    expect(longName.length).toBeLessThanOrEqual(80)
    const response = await page.request.post('/api/formats', { data: { name: longName, rules: { rules: [] } } })
    expect(response.ok()).toBe(true)

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/decks')
      await waitForHydration(page)

      // Measured before opening: the open menu hides the rest of the page
      // from the accessibility tree.
      const trigger = page.getByRole('combobox', { name: 'Format' })
      const triggerBox = await trigger.boundingBox()
      await trigger.click()
      const listbox = page.getByRole('listbox')
      const option = listbox.getByRole('option', { name: longName })
      await expect(option).toBeVisible()

      // Let the open animation (a scale-in) finish before measuring.
      await page.locator('[role="listbox"]').evaluate(element =>
        Promise.all((element.closest('[data-slot="content"]') ?? element).getAnimations().map(animation => animation.finished)))
      const listboxBox = await listbox.boundingBox()
      if (width > 1000) {
        expect(listboxBox!.width).toBeGreaterThan(triggerBox!.width)
      }
      else {
        // On a phone the field already spans the page; the menu keeps at
        // least its width and stays on screen.
        expect(listboxBox!.width).toBeGreaterThanOrEqual(triggerBox!.width - 1)
      }
      expect(listboxBox!.x).toBeGreaterThanOrEqual(0)
      expect(listboxBox!.x + listboxBox!.width).toBeLessThanOrEqual(width)

      const label = option.locator('[data-slot="itemLabel"]')
      const { scrollWidth, clientWidth } = await label.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.keyboard.press('Escape')
    }
  })
})
