import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

// Automated WCAG 2.1 A/AA checks (color contrast included) on the key pages,
// in both color modes (docs/adr/0016-visual-design-system.md). Complements
// e2e/a11y.spec.ts (skip link, 44px targets), which axe can't judge.

// Passcode from the seeded E2E catalog fixture (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

const COLOR_MODES = ['dark', 'light'] as const

async function useColorMode(page: Page, mode: typeof COLOR_MODES[number]) {
  const baseURL = test.info().project.use.baseURL!
  await page.context().addCookies([{ name: 'ygo-color-mode', value: mode, url: baseURL }])
  // Mid-transition colors would make the contrast check flaky.
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

async function axeViolations(page: Page, path: string): Promise<string[]> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return results.violations.map(violation =>
    `${path}: ${violation.id} (${violation.impact}) — ${violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(' | ')}`)
}

test.describe('axe: no WCAG A/AA violations', () => {
  for (const mode of COLOR_MODES) {
    test(`on the key pages in ${mode} mode`, async ({ page }) => {
      test.setTimeout(120_000)
      await useColorMode(page, mode)

      const violations: string[] = []
      violations.push(...await axeViolations(page, '/login'))

      await registerAndLogin(page)
      const profile = await (await page.request.get('/api/profile')).json() as { handle: string }

      const inventoryResponse = await page.request.post('/api/inventory', {
        data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
      })
      expect(inventoryResponse.ok()).toBe(true)
      const deckResponse = await page.request.post('/api/decks', {
        data: { name: 'Axe Deck', cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }] },
      })
      expect(deckResponse.ok()).toBe(true)
      const deck = await deckResponse.json() as { id: string }
      const tournamentResponse = await page.request.post('/api/tournaments', { data: { name: 'Axe Turnier' } })
      expect(tournamentResponse.ok()).toBe(true)
      const tournament = await tournamentResponse.json() as { id: string }

      for (const path of [
        '/',
        '/inventory',
        '/inventory?view=overview',
        '/catalog',
        `/catalog?card=${DARK_MAGICIAN}`,
        '/decks',
        `/decks/${deck.id}`,
        '/assistant',
        `/tournaments/${tournament.id}`,
        `/players/${profile.handle}`,
      ]) {
        violations.push(...await axeViolations(page, path))
      }

      expect(violations).toEqual([])
    })
  }
})
