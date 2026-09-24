import { expect, test } from '@playwright/test'
import { registerAndLogin, waitForHydration } from './helpers/auth'

// Passcode from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

// Conversations aren't linked to decks, and decks have no entry point into
// the assistant (docs/adr/0021-no-deck-link-in-assistant-conversations.md):
// the assistant reads decks through its tools. The Playwright webServer runs
// with NUXT_ASSISTANT_PROVIDER=fake, which echoes "Testantwort: <text>".
test.describe('Assistant without a deck link', () => {
  test('conversations aren\'t linked to decks, and decks have no assistant entry point (ADR 0021)', async ({ page }) => {
    await registerAndLogin(page)

    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: `Kein-Link-Deck ${Date.now()}`,
        cards: [{ catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 3 }],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json() as { id: string }

    // An old client that still sends `{ deckId }` gets a plain conversation.
    const created = await page.request.post('/api/assistant/chat', { data: { deckId: deck.id } })
    expect(created.status()).toBe(201)
    const conversation = await created.json() as Record<string, unknown> & { id: string }
    expect(conversation).not.toHaveProperty('deck')
    expect(conversation.title).toBe('Neue Unterhaltung')

    // No "Mit KI …" button in the deck editor or on /decks (the sidebar
    // keeps its /assistant link, so only `main` is checked).
    for (const path of [`/decks/${deck.id}`, '/decks']) {
      await page.goto(path)
      await waitForHydration(page)
      await expect(page.locator('main').getByRole('link', { name: /Mit KI/ })).toHaveCount(0)
      await expect(page.locator('main a[href^="/assistant"]')).toHaveCount(0)
    }

    // The conversation opens without a draft or a deck chip, and the fake
    // model gets no deck context: it just echoes.
    await page.goto(`/assistant/${conversation.id}`)
    await waitForHydration(page)
    const nachricht = page.getByLabel('Nachricht', { exact: true })
    await expect(nachricht).toHaveValue('')
    await expect(page.getByRole('heading', { level: 1, name: 'Neue Unterhaltung' })).toBeVisible()

    await nachricht.fill('Was ist in meinem Deck?')
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.getByText('Testantwort: Was ist in meinem Deck?')).toBeVisible()
    await expect(page.getByRole('link', { name: /^Deck .* öffnen$/ })).toHaveCount(0)
  })
})
