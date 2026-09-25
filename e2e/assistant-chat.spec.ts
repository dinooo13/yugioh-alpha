import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { registerAndLogin, waitForHydration } from './helpers/auth'
import { acceptConfirm } from './helpers/confirm'
import { CARD } from './helpers/cards'

// Passcode from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts) — the fixture has exactly one
// card whose name contains "Dark Magician", so every count/name assertion
// below is unambiguous.
const DARK_MAGICIAN = 46986414

// The E2E server's database (playwright.config.ts), for seeding rows the UI
// can't create any more (conversations of the former engine).
const E2E_DB_FILE = fileURLToPath(new URL('../e2e-data/e2e.db', import.meta.url))

// A minimal, genuinely decodable 1x1 transparent PNG — the composer resizes
// whatever is picked via `createImageBitmap` before sending it, so a fake
// byte string wouldn't survive that step; this has to be a real image.
const ONE_PIXEL_PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test.describe('Chat assistant', () => {
  test('searches the catalog, proposes and applies an inventory change, understands a photo, and manages conversations', async ({ page }) => {
    await registerAndLogin(page)

    // Seed one owned Dark Magician through the API (same session cookie as
    // the page) so "füge 2 hinzu" below lands on a total of 3, not 2.
    const seedResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 1 },
    })
    expect(seedResponse.ok()).toBe(true)

    await page.getByRole('link', { name: 'Assistent', exact: true }).click()
    await expect(page).toHaveURL('/assistant')

    // Fresh account: no conversations exist yet, so /assistant shows the
    // empty state — its primary "Neue Unterhaltung" button (not one of the
    // example prompts below it) creates an empty conversation and navigates
    // straight into it, with nothing auto-sent.
    await page.getByRole('button', { name: 'Neue Unterhaltung', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)

    const nachricht = page.getByLabel('Nachricht', { exact: true })
    const senden = page.getByRole('button', { name: 'Senden', exact: true })

    await expect(nachricht).toBeEnabled()

    // --- search_catalog ---------------------------------------------------
    await nachricht.fill('suche Dark Magician')
    await senden.click()

    await expect(page.getByText('Sucht im Katalog: Dark Magician')).toBeVisible()
    await expect(page.getByText('Ich habe 1 Karte gefunden: Dark Magician')).toBeVisible()
    await expect(nachricht).toBeEnabled()

    // --- add_to_inventory proposal -----------------------------------------
    // Exactly one action card is ever visible in this conversation, so a
    // page-wide lookup for its status/buttons is unambiguous.
    await nachricht.fill('füge 2 hinzu')
    await senden.click()

    await expect(page.getByText('Karten ins Inventar aufnehmen')).toBeVisible()
    await expect(page.getByText('Wartet auf Bestätigung')).toBeVisible()
    // The proposal ends the answer (ADR 0026): the text comes before the card, nothing after it.
    const proposalText = page.getByText('Hier ist mein Vorschlag.')
    await expect(proposalText).toBeVisible()
    await expect(page.getByText('Ich habe einen Vorschlag angelegt.')).toHaveCount(0)
    const textBox = await proposalText.boundingBox()
    const buttonBox = await page.getByRole('button', { name: 'Übernehmen', exact: true }).boundingBox()
    expect(textBox!.y).toBeLessThan(buttonBox!.y)
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click()
    await expect(page.getByText('Übernommen')).toBeVisible()
    await expect(nachricht).toBeEnabled()

    // --- applied for real: 1 seeded + 2 proposed = 3 -----------------------
    await page.goto('/inventory')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Galerie', exact: true }).click()
    await expect(page.getByText(CARD.darkMagician).first()).toBeVisible()
    await expect(page.getByText('×3 ges.')).toBeVisible()

    // --- new conversation, image input --------------------------------------
    await page.goto('/assistant')
    await waitForHydration(page)
    // A conversation exists now, so this redirects into it — the aside with
    // the conversation list (and "Neue Unterhaltung") is only reachable from
    // inside a thread, not from the bare empty state.
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)
    const firstConversationUrl = page.url()

    // The app layout has its own `<aside>` sidebar (nav + collections) —
    // scope to the one that actually holds the conversation list, rather
    // than assuming it's the only `<aside>` on the page.
    const conversationAside = page.locator('aside').filter({
      has: page.getByRole('button', { name: 'Neue Unterhaltung', exact: true }),
    })
    await conversationAside.getByRole('button', { name: 'Neue Unterhaltung', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)
    await expect(page).not.toHaveURL(firstConversationUrl)

    // Both the hidden `<input type="file">` and the visible button that
    // triggers it share the "Foto hinzufügen" accessible name — only the
    // input accepts `setInputFiles`.
    await page.locator('input[type="file"][aria-label="Foto hinzufügen"]').setInputFiles({
      name: 'karte.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
    })
    await expect(senden).toBeEnabled()
    await senden.click()

    await expect(page.getByText('Dark Magician', { exact: false }).first()).toBeVisible()
    await expect(nachricht).toBeEnabled()

    // --- conversation list: title written by the title model, delete -------
    // The first conversation was titled by the (fake) title model after the
    // first exchange (#129) — from its first message "suche Dark Magician",
    // sent right after the empty conversation was created.
    const firstConversationItem = conversationAside.locator('li').filter({ hasText: 'Thema: suche Dark Magician' })
    await expect(firstConversationItem.getByRole('link', { name: 'Thema: suche Dark Magician', exact: true })).toBeVisible()

    await firstConversationItem.getByRole('button').click()
    await acceptConfirm(page)
    await expect(firstConversationItem).toHaveCount(0)
  })

  // Regression: the end of every assistant turn used to hide the whole
  // thread behind a loading state while re-syncing, so it was torn down and
  // remounted at scrollTop 0 — whenever an action card showed up, the user
  // was thrown back to the top of the conversation.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    test(`action card appears without scrolling the page or resetting the thread (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await registerAndLogin(page)

      const createResponse = await page.request.post('/api/assistant/chat')
      expect(createResponse.ok()).toBe(true)
      const { id } = await createResponse.json() as { id: string }
      await page.goto(`/assistant/${id}`)
      await waitForHydration(page)

      const nachricht = page.getByLabel('Nachricht', { exact: true })
      const senden = page.getByRole('button', { name: 'Senden', exact: true })
      const thread = page.getByTestId('assistant-thread')

      async function sendAndWait(text: string, answer: string) {
        await nachricht.fill(text)
        await senden.click()
        await expect(page.getByText(answer).last()).toBeVisible()
        await expect(nachricht).toBeEnabled()
      }

      // Enough plain back-and-forth (the fake provider just echoes these)
      // that the thread has to scroll.
      for (let index = 1; index <= 6; index++) {
        const filler = `Erzähl mir bitte etwas Längeres über das Kartenspiel, damit der Verlauf ordentlich wächst. Nachricht ${index}`
        await sendAndWait(filler, `Testantwort: ${filler}`)
      }
      await sendAndWait('suche Dark Magician', 'Ich habe 1 Karte gefunden: Dark Magician')

      expect(await thread.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)

      // Survives only if the thread element is never unmounted/remounted.
      await thread.evaluate((el) => {
        el.dataset.marker = '1'
      })

      await nachricht.fill('füge 2 hinzu')
      await senden.click()
      await expect(page.getByText('Wartet auf Bestätigung')).toBeVisible()
      await expect(nachricht).toBeEnabled()

      async function expectPageDoesNotScroll() {
        const page_ = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          scrollY: window.scrollY,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(page_.scrollHeight).toBeLessThanOrEqual(page_.innerHeight)
        expect(page_.scrollY).toBe(0)
        expect(page_.scrollWidth).toBeLessThanOrEqual(page_.clientWidth)
      }

      await expectPageDoesNotScroll()
      await expect(thread).toHaveAttribute('data-marker', '1')
      expect(await thread.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2)

      const uebernehmen = page.getByRole('button', { name: 'Übernehmen', exact: true })
      await expect(uebernehmen).toBeInViewport()
      await uebernehmen.click()
      await expect(page.getByText('Übernommen')).toBeVisible()

      await expectPageDoesNotScroll()
      await expect(thread).toHaveAttribute('data-marker', '1')
    })
  }

  test('/inventory/quick-entry points to the assistant instead of offering its own Foto/Sprache modes', async ({ page }) => {
    await registerAndLogin(page)
    await page.goto('/inventory/quick-entry')

    await expect(page.getByText('Karten per Foto? Nutze den Assistenten')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Foto' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Sprache' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Zum Assistenten', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant/)
  })

  test('runs in English for an English interface: chips, action card and saved texts (#34 F2d)', async ({ page, context, baseURL }) => {
    await registerAndLogin(page)
    await context.addCookies([{ name: 'ui_locale', value: 'en', url: baseURL! }])

    await page.goto('/assistant')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: 'Assistant', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]+$/)

    const message = page.getByLabel('Message', { exact: true })
    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expect(message).toBeEnabled()

    // The fake provider keeps its German trigger words and replies.
    await message.fill('suche Dark Magician')
    await send.click()
    await expect(page.getByText('Searching the catalog: Dark Magician')).toBeVisible()
    await expect(page.getByText('1 result', { exact: false })).toBeVisible()

    await message.fill('add 2')
    await send.click()
    await expect(page.getByText('Add cards to the inventory')).toBeVisible()
    await expect(page.getByText('Add 1 card to the inventory: Dark Magician x2')).toBeVisible()
    await expect(page.getByText('Waiting for confirmation')).toBeVisible()
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(page.getByText('Rejected')).toBeVisible()

    // The conversation list shows the conversation, titled by the (fake)
    // title model in the interface language (#129).
    await expect(page.getByRole('link', { name: 'Topic: suche Dark Magician' }).first()).toBeVisible()
  })
})


// --- #84: the thread on the AI SDK's chat client ----------------------------

test.describe('Chat assistant on the AI SDK (#84)', () => {
  async function openNewConversation(page: Page): Promise<string> {
    const createResponse = await page.request.post('/api/assistant/chat')
    expect(createResponse.ok()).toBe(true)
    const { id } = await createResponse.json() as { id: string }
    await page.goto(`/assistant/${id}`)
    await waitForHydration(page)
    return id
  }

  test('a reload keeps the chips, the proposal and its applied state', async ({ page }) => {
    await registerAndLogin(page)
    await openNewConversation(page)
    const nachricht = page.getByLabel('Nachricht', { exact: true })
    const senden = page.getByRole('button', { name: 'Senden', exact: true })

    await nachricht.fill('suche Dark Magician')
    await senden.click()
    await expect(page.getByText('Ich habe 1 Karte gefunden: Dark Magician')).toBeVisible()
    await nachricht.fill('füge 2 hinzu')
    await senden.click()
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click()
    await expect(page.getByText('Übernommen')).toBeVisible()

    await page.reload()
    await waitForHydration(page)
    await expect(page.getByText('Sucht im Katalog: Dark Magician')).toBeVisible()
    await expect(page.getByText('1 Ergebnis', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Schlägt vor, Karten ins Inventar aufzunehmen')).toBeVisible()
    await expect(page.getByText(`1 Karte zum Inventar hinzufügen: ${CARD.darkMagician} x2`)).toBeVisible()
    await expect(page.getByText('Übernommen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Übernehmen', exact: true })).toHaveCount(0)
    await expect(page.getByText('Hier ist mein Vorschlag.')).toBeVisible()
  })

  test('a conversation of the former engine opens and goes on', async ({ page }) => {
    await registerAndLogin(page)
    const createResponse = await page.request.post('/api/assistant/chat')
    const { id } = await createResponse.json() as { id: string }

    // Rows as the former engine stored them: one row per model round, a
    // 'tool' row per result, the proposal attached to its round.
    const db = new Database(E2E_DB_FILE)
    try {
      const { user_id: userId } = db.prepare('SELECT user_id FROM assistant_conversation WHERE id = ?').get(id) as { user_id: string }
      const t = Date.now() - 60_000
      const insert = db.prepare(`INSERT INTO assistant_message (id, conversation_id, role, content, tool_calls, tool_call_id, tool_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      insert.run(`${id}-u1`, id, 'user', 'suche Dark Magician', null, null, null, t)
      insert.run(`${id}-a1`, id, 'assistant', '', JSON.stringify([{ id: 'legacy-call-1', name: 'search_catalog', arguments: { query: 'Dark Magician' } }]), null, null, t + 1)
      insert.run(`${id}-t1`, id, 'tool', JSON.stringify([{ id: DARK_MAGICIAN, name: 'Dark Magician' }]), null, 'legacy-call-1', 'search_catalog', t + 2)
      insert.run(`${id}-a2`, id, 'assistant', 'Alte Antwort: 1 Karte gefunden.', null, null, null, t + 3)
      db.prepare(`INSERT INTO assistant_action (id, conversation_id, message_id, user_id, kind, payload, summary, status, created_at)
        VALUES (?, ?, ?, ?, 'add_to_inventory', ?, '1 Karte(n) zum Inventar hinzufügen: Dark Magician x1', 'rejected', ?)`)
        .run(`${id}-act`, id, `${id}-a1`, userId, JSON.stringify({ items: [{ catalogCardId: DARK_MAGICIAN, name: 'Dark Magician', quantity: 1 }] }), t + 1)
    }
    finally {
      db.close()
    }

    await page.goto(`/assistant/${id}`)
    await waitForHydration(page)
    const thread = page.getByTestId('assistant-thread')
    await expect(thread.getByText('suche Dark Magician')).toBeVisible()
    await expect(thread.getByText('Sucht im Katalog: Dark Magician')).toBeVisible()
    await expect(thread.getByText('Alte Antwort: 1 Karte gefunden.')).toBeVisible()
    await expect(thread.getByText('Verworfen', { exact: true })).toBeVisible()

    // The follow-up reads the old search result from the converted history.
    await page.getByLabel('Nachricht', { exact: true }).fill('füge 2 hinzu')
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.getByText('Wartet auf Bestätigung')).toBeVisible()
    await expect(page.getByText(`1 Karte zum Inventar hinzufügen: ${CARD.darkMagician} x2`)).toBeVisible()
  })

  test('"Abbrechen" stops the answer and keeps what came, marked "(abgebrochen)"', async ({ page }) => {
    await registerAndLogin(page)
    await openNewConversation(page)

    await page.getByLabel('Nachricht', { exact: true }).fill('langsame antwort bitte')
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.getByText(/Wort3/)).toBeVisible()
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click()

    await expect(page.getByText(/\(abgebrochen\)/)).toBeVisible()
    await expect(page.getByText(/Wort60/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Senden', exact: true })).toBeVisible()

    await page.reload()
    await waitForHydration(page)
    await expect(page.getByText(/\(abgebrochen\)/)).toBeVisible()
  })

  test('empty tool arguments end in a text answer instead of a loop (#54)', async ({ page }) => {
    await registerAndLogin(page)
    await openNewConversation(page)

    await page.getByLabel('Nachricht', { exact: true }).fill('leere argumente')
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
    await expect(page.getByText('Ich kann das Werkzeug gerade nicht nutzen.')).toBeVisible()
    // Two identical failures, then tools were switched off.
    await expect(page.locator('[data-testid="assistant-tool"][data-outcome="error"]')).toHaveCount(2)
    await expect(page.getByLabel('Nachricht', { exact: true })).toBeEnabled()
  })
})


// --- #128 / #129: card names in chips, collapsed reasoning, model titles ----

test.describe('Assistant polish (#128, #129)', () => {
  async function openNewConversation(page: Page): Promise<string> {
    const createResponse = await page.request.post('/api/assistant/chat')
    expect(createResponse.ok()).toBe(true)
    const { id } = await createResponse.json() as { id: string }
    await page.goto(`/assistant/${id}`)
    await waitForHydration(page)
    return id
  }

  async function send(page: Page, text: string) {
    const nachricht = page.getByLabel('Nachricht', { exact: true })
    await nachricht.fill(text)
    await page.getByRole('button', { name: 'Senden', exact: true }).click()
  }

  test('a get_card chip names the card, in the card language, also after a reload', async ({ page }) => {
    await registerAndLogin(page)
    await openNewConversation(page)

    await send(page, `zeige karte ${DARK_MAGICIAN}`)
    await expect(page.getByText('Kartendetails gelesen.')).toBeVisible()
    const chip = page.getByTestId('assistant-tool')
    await expect(chip).toContainText(`Liest Kartendetails: ${CARD.darkMagician}`)
    await expect(chip).not.toContainText(String(DARK_MAGICIAN))

    await page.reload()
    await waitForHydration(page)
    await expect(page.getByTestId('assistant-tool')).toContainText(`Liest Kartendetails: ${CARD.darkMagician}`)
  })

  test('the model\'s reasoning stays collapsed until the user opens it', async ({ page }) => {
    await registerAndLogin(page)
    await openNewConversation(page)

    await send(page, 'denk nach')
    await expect(page.getByText('Fertig überlegt.')).toBeVisible()
    const trigger = page.getByTestId('assistant-reasoning').locator('[data-slot="trigger"]')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('Ich überlege kurz.')).toBeHidden()

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Ich überlege kurz.')).toBeVisible()

    await page.reload()
    await waitForHydration(page)
    await expect(page.getByTestId('assistant-reasoning').locator('[data-slot="trigger"]')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('Ich überlege kurz.')).toBeHidden()
  })

  test('the title model names the conversation in list and header; the title is stored', async ({ page }) => {
    await registerAndLogin(page)
    await openNewConversation(page)

    await send(page, 'suche Dark Magician')
    await expect(page.getByText('Ich habe 1 Karte gefunden: Dark Magician')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Thema: suche Dark Magician', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thema: suche Dark Magician')

    await page.reload()
    await waitForHydration(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thema: suche Dark Magician')
    await expect(page.getByRole('link', { name: 'Thema: suche Dark Magician', exact: true }).first()).toBeVisible()
  })

  test('a failing title model keeps the first message as the title', async ({ page }) => {
    await registerAndLogin(page)
    const id = await openNewConversation(page)

    await send(page, 'titel-fehler bitte')
    await expect(page.getByText('Testantwort: titel-fehler bitte')).toBeVisible()
    await expect(page.getByLabel('Nachricht', { exact: true })).toBeEnabled()
    await expect(page.getByRole('link', { name: 'titel-fehler bitte', exact: true }).first()).toBeVisible()
    // The title request has come back by now: the title stayed.
    await expect.poll(async () => {
      const response = await page.request.get(`/api/assistant/chat/${id}`)
      return (await response.json() as { conversation: { title: string } }).conversation.title
    }).toBe('titel-fehler bitte')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('titel-fehler bitte')
  })
})
