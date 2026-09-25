import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { CARD, CARD_EN } from './helpers/cards'

// The chat's tool chips (app/components/assistant/ToolPart.vue). The
// Playwright webServer runs with NUXT_ASSISTANT_PROVIDER=fake: "zeige karte
// <id>" calls get_card, "suche <term>" calls search_catalog.
const DARK_MAGICIAN = 46986414

async function openNewConversation(page: Page): Promise<string> {
  const createResponse = await page.request.post('/api/assistant/chat')
  expect(createResponse.ok()).toBe(true)
  const { id } = await createResponse.json() as { id: string }
  await page.goto(`/assistant/${id}`)
  await waitForHydration(page)
  return id
}

async function send(page: Page, text: string) {
  await page.getByLabel('Nachricht', { exact: true }).fill(text)
  await page.getByRole('button', { name: 'Senden', exact: true }).click()
}

test.describe('Assistant tool chips', () => {
  test('a get_card chip follows a later switch of the card language (#132)', async ({ page }) => {
    await registerAndLogin(page)
    expect((await page.request.patch('/api/profile', { data: { cardLocale: 'en' } })).ok()).toBe(true)
    await openNewConversation(page)

    await send(page, `zeige karte ${DARK_MAGICIAN}`)
    await expect(page.getByText('Kartendetails gelesen.')).toBeVisible()
    await expect(page.getByTestId('assistant-tool')).toContainText(`Liest Kartendetails: ${CARD_EN.darkMagician}`)

    // The turn ran in English card language, so its result has no German
    // name; the chip still shows it once the card language is German.
    expect((await page.request.patch('/api/profile', { data: { cardLocale: 'de' } })).ok()).toBe(true)
    await page.reload()
    await waitForHydration(page)
    await expect(page.getByTestId('assistant-tool')).toContainText(`Liest Kartendetails: ${CARD.darkMagician}`)
  })

  test('a chip wraps on a phone instead of cutting off its outcome (#125)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await registerAndLogin(page)
    await openNewConversation(page)

    await send(page, 'suche Irgendeine sehr lange Kartenbezeichnung ohne Treffer')
    await expect(page.getByText('Ich habe 0 Karten gefunden')).toBeVisible()
    const chip = page.getByTestId('assistant-tool')
    await expect(chip).toHaveAttribute('data-outcome', 'ok')

    const label = chip.locator('[data-slot="label"]')
    const { scrollWidth, clientWidth } = await label.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

    const suffix = chip.locator('[data-slot="suffix"]')
    await expect(suffix).toContainText('0 Ergebnisse')
    const box = (await suffix.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })
})
