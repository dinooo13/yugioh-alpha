import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { registerAndLogin, waitForHydration } from './helpers/auth'

// The assistant's answers as sanitized Markdown
// (docs/adr/0023-markdown-in-assistant-answers.md): a stored answer with a
// table, a list, code and links renders as elements, raw HTML and unsafe
// links don't, a wide table scrolls inside its own wrapper on a phone, and
// the thread has no WCAG A/AA violations in either color mode.

// The E2E server's database (playwright.config.ts), for seeding a stored answer.
const E2E_DB_FILE = fileURLToPath(new URL('../e2e-data/e2e.db', import.meta.url))

const QUESTION = 'Zeig mir eine Tabelle'

const ANSWER = [
  '## Vergleich',
  '',
  '| Karte | ATK | DEF | Effekt |',
  '|---|---:|---:|---|',
  '| Dark Magician | 2500 | 2100 | Ein normales Monster ohne Effekt, das in unzähligen Decks als Ziel für Beschwörungen und Unterstützungskarten dient: Dark Magic Attack, Thousand Knives, Magician\'s Rod, Dark Magical Circle |',
  '| Blue-Eyes White Dragon | 3000 | 2500 | Ebenfalls ein normales Monster |',
  '',
  '- Blue-Eyes hat die höheren Werte.',
  '- Dark Magician hat mehr Unterstützung, etwa `Dark Magic Attack`.',
  '',
  '```',
  '<b>x</b> bleibt Text',
  '```',
  '',
  'Mehr auf [yugioh-card.com](https://www.yugioh-card.com) oder [böse](javascript:alert(1)).',
  '',
  '<script>window.__pwned = 1</script> und <img src=x onerror="window.__pwned = 2">',
].join('\n')

const COLOR_MODES = ['dark', 'light'] as const

async function seedConversation(page: Page): Promise<string> {
  const createResponse = await page.request.post('/api/assistant/chat')
  expect(createResponse.ok()).toBe(true)
  const { id } = await createResponse.json() as { id: string }

  const db = new Database(E2E_DB_FILE)
  try {
    const t = Date.now() - 60_000
    const insert = db.prepare(`INSERT INTO assistant_message (id, conversation_id, role, content, parts, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    insert.run(`${id}-u1`, id, 'user', QUESTION, JSON.stringify([{ type: 'text', text: QUESTION, state: 'done' }]), t)
    insert.run(`${id}-a1`, id, 'assistant', ANSWER, JSON.stringify([{ type: 'text', text: ANSWER, state: 'done' }]), t + 1)
  }
  finally {
    db.close()
  }
  return id
}

async function openConversation(page: Page, id: string) {
  await page.goto(`/assistant/${id}`)
  await waitForHydration(page)
  await expect(page.getByTestId('assistant-thread').getByRole('table')).toBeVisible()
}

test.describe('assistant answers as Markdown', () => {
  test('render a table, lists, code and links, but no HTML and no unsafe links', async ({ page }) => {
    await registerAndLogin(page)
    const id = await seedConversation(page)
    await openConversation(page, id)

    const thread = page.getByTestId('assistant-thread')
    const table = thread.getByRole('table')
    await expect(table.getByRole('columnheader', { name: 'Karte' })).toBeVisible()
    await expect(table.getByRole('cell', { name: '3000' })).toBeVisible()
    await expect(thread.getByRole('heading', { name: 'Vergleich', level: 2 })).toBeVisible()
    await expect(thread.getByRole('listitem').filter({ hasText: 'höheren Werte' })).toBeVisible()
    await expect(thread.locator('pre code')).toContainText('<b>x</b> bleibt Text')

    // The user's own message stays plain text.
    await expect(thread.getByText(QUESTION, { exact: true })).toBeVisible()

    const external = thread.getByRole('link', { name: 'yugioh-card.com' })
    await expect(external).toHaveAttribute('href', 'https://www.yugioh-card.com')
    await expect(external).toHaveAttribute('target', '_blank')
    await expect(external).toHaveAttribute('rel', /noopener/)

    await expect(thread.locator('a[href^="javascript:"]')).toHaveCount(0)
    await expect(thread.locator('script')).toHaveCount(0)
    await expect(thread.locator('img')).toHaveCount(0)
    await expect(thread.getByText('<script>window.__pwned = 1</script>', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined()
  })

  test('a wide table scrolls inside its wrapper on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)
    const id = await seedConversation(page)
    await openConversation(page, id)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  for (const mode of COLOR_MODES) {
    test(`has no WCAG A/AA violations in ${mode} mode`, async ({ page }) => {
      const baseURL = test.info().project.use.baseURL!
      await page.context().addCookies([{ name: 'ygo-color-mode', value: mode, url: baseURL }])
      // Mid-transition colors would make the contrast check flaky.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await registerAndLogin(page)
      const id = await seedConversation(page)
      await openConversation(page, id)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .include('[data-testid="assistant-thread"]')
        .analyze()
      const violations = results.violations.map(violation =>
        `${violation.id} (${violation.impact}) — ${violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(' | ')}`)
      expect(violations).toEqual([])
    })
  }
})
