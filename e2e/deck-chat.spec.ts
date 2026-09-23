import { expect, test } from '@playwright/test'
import { registerAndLogin } from './helpers/auth'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const KURIBOH = 40640057

// Deck assistance lives in the chat assistant (docs/adr/0011): the deck
// editor's "Mit KI bearbeiten" opens a conversation linked to the deck, and
// /decks' "Mit KI erstellen" opens a plain one with a new-deck draft. The
// Playwright webServer runs with NUXT_ASSISTANT_PROVIDER=fake, whose chat
// answers "Kontext-Deck: <name> (<n> Karten)" when the linked deck's
// context block reached the system prompt.
test.describe('Deck assistance in the chat', () => {
  test('opens a deck-linked conversation from the deck editor and a new-deck conversation from /decks', async ({ page }) => {
    await registerAndLogin(page)

    for (const [catalogCardId, quantity] of [[DARK_MAGICIAN, 3], [KURIBOH, 2]] as const) {
      const response = await page.request.post('/api/inventory', { data: { catalog_card_id: catalogCardId, quantity } })
      expect(response.ok()).toBe(true)
    }

    const deckName = `Chat-Deck ${Date.now()}`
    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: deckName,
        cards: [
          { catalogCardId: DARK_MAGICIAN, section: 'main', quantity: 3 },
          { catalogCardId: KURIBOH, section: 'main', quantity: 2 },
        ],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json() as { id: string }

    // --- Deck editor → "Mit KI bearbeiten" ---------------------------------
    await page.goto(`/decks/${deck.id}`)
    await page.getByRole('link', { name: 'Mit KI bearbeiten', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)

    const deckChip = page.getByRole('link', { name: `Deck ${deckName} öffnen`, exact: true })
    await expect(deckChip).toBeVisible()
    await expect(deckChip).toHaveText(`Deck: ${deckName}`)

    // The edit-deck draft is pre-filled, not sent.
    const nachricht = page.getByLabel('Nachricht', { exact: true })
    await expect(nachricht).toHaveValue('Wie kann ich dieses Deck mit Karten aus meinem Inventar verbessern?')
    await expect(page.getByTestId('assistant-thread').getByText('Wie kann ich dieses Deck')).toHaveCount(0)

    await nachricht.fill('Was ist in meinem Deck?')
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.getByText(`Kontext-Deck: ${deckName} (5 Karten)`)).toBeVisible()

    await deckChip.click()
    await expect(page).toHaveURL(`/decks/${deck.id}`)

    // --- /decks → "Mit KI erstellen" ----------------------------------------
    await page.goto('/decks')
    await page.getByRole('link', { name: 'Mit KI erstellen', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)
    await expect(page.getByLabel('Nachricht', { exact: true }))
      .toHaveValue('Baue mir aus meinen Karten ein neues Deck. Format und Spielstil: ')
    await expect(page.getByRole('link', { name: /^Deck .* öffnen$/ })).toHaveCount(0)

    // --- An old /decks/assistent bookmark lands in the chat too --------------
    await page.goto('/decks/assistent')
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)
    await expect(page.getByLabel('Nachricht', { exact: true }))
      .toHaveValue('Baue mir aus meinen Karten ein neues Deck. Format und Spielstil: ')
  })
})
