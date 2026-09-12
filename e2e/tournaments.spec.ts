import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { registerAndLogin, uniqueEmail } from './helpers/auth'
import { acceptConfirm, cancelConfirm } from './helpers/confirm'

/**
 * `fill` followed by a value check, with one retry.
 *
 * Right after a fresh navigation (`page.goto`) into a page guarded by the
 * global auth middleware, the client re-runs that middleware once during
 * hydration — a `getAuthSession` round trip that can still be settling the
 * form when Playwright's `fill` lands, silently discarding it. The window is
 * a few tens of milliseconds and never repeats once past it, so a single
 * retry is enough to make this deterministic instead of racy: if the value
 * didn't stick, the disruptive re-render has already happened, and refilling
 * lands cleanly. Without this, an unlucky fill can submit an empty field and
 * fail validation instead of creating the record (e.g. "Bitte einen Namen
 * angeben.").
 */
async function fillReliably(locator: Locator, value: string) {
  await locator.fill(value)
  try {
    await expect(locator).toHaveValue(value, { timeout: 1000 })
  }
  catch {
    await locator.fill(value)
    await expect(locator).toHaveValue(value)
  }
}

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414
const KURIBOH = 40640057
const POT_OF_GREED = 55144522
const MIRROR_FORCE = 44095762
const STARDUST_DRAGON = 44508094 // extra deck

/**
 * A match row is the only bordered `.p-3` block on the tournament detail page
 * (the surrounding sections all use `.p-4`). Scoping to it lets the same
 * "2:0" / "Tisch N" labels be reused unambiguously across every round.
 */
function matchRow(page: import('@playwright/test').Page, tableNumber: number) {
  return page.locator('div.rounded-md.border.border-gray-200.p-3').filter({ hasText: `Tisch ${tableNumber}` })
}

/**
 * The participants table row for a given name. Standings render a row per
 * participant too (with zero stats before any round is played), so a plain
 * `getByRole('row').filter({ hasText })` matches both tables once standings
 * are non-empty. The participants table is the first `<table>` on the page
 * (ParticipantsPanel renders before StandingsTable), so scoping to it keeps
 * the lookup unambiguous.
 */
function participantRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('table').first().getByRole('row').filter({ hasText: name })
}

test.describe('tournaments', () => {
  test('runs a Swiss tournament from creation to finish', async ({ page }) => {
    const organizer = await registerAndLogin(page)

    // Seed a deck through the API with the page's session cookie (same
    // trick as e2e/decks.spec.ts). It is deliberately too small (13 cards)
    // to be legal against a standard 40-card-minimum format.
    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: 'Turnierdeck',
        cards: [
          { catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 },
          { catalog_card_id: KURIBOH, section: 'main', quantity: 3 },
          { catalog_card_id: POT_OF_GREED, section: 'main', quantity: 3 },
          { catalog_card_id: MIRROR_FORCE, section: 'main', quantity: 3 },
          { catalog_card_id: STARDUST_DRAGON, section: 'extra', quantity: 1 },
        ],
      },
    })
    expect(deckResponse.ok()).toBe(true)

    // --- Empty state, create the tournament ---------------------------------
    await page.goto('/turniere')
    await expect(page.getByText('Noch keine Turniere')).toBeVisible()

    // "Neues Turnier" is a `<UButton to="...">`, rendered as a link, not a button.
    await page.getByRole('link', { name: 'Neues Turnier' }).first().click()
    await expect(page).toHaveURL('/turniere/neu')

    await fillReliably(page.getByLabel('Turniername'), 'Freitagsturnier')
    await page.getByLabel('Format').click()
    await page.getByRole('option', { name: 'Ohne Banliste' }).click()
    await page.getByLabel('Paarungssystem').click()
    await page.getByRole('option', { name: 'Schweizer System' }).click()
    // "Geplante Runden" stays empty — resolved from the participant count at
    // start. "Ich spiele selbst mit" stays checked (default).

    await page.getByRole('button', { name: 'Turnier anlegen' }).click()

    await expect(page).toHaveURL(/\/turniere\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'Freitagsturnier' })).toBeVisible()
    await expect(page.getByText('Anmeldung')).toBeVisible()

    // --- Add three guests ----------------------------------------------------
    await page.getByRole('button', { name: 'Als Gast' }).click()
    const guestNameField = page.getByLabel('Name')
    for (const name of ['Alice', 'Bob', 'Carla']) {
      // The field is only guaranteed empty (cleared by the previous
      // successful submit) once its own row is visible — wait for that
      // first, otherwise a fast `fill` can land before the clear and be
      // immediately overwritten, submitting an empty name.
      await expect(guestNameField).toHaveValue('')
      await fillReliably(guestNameField, name)
      await page.getByRole('button', { name: 'Teilnehmer hinzufügen' }).click()
      await expect(participantRow(page, name)).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Teilnehmer (4)' })).toBeVisible()

    // --- Register the organizer's own deck -----------------------------------
    const organizerRow = participantRow(page, organizer.name)
    await organizerRow.getByRole('button', { name: 'Deck anmelden' }).click()

    // exact: true — otherwise this also matches the "Deck anmelden" dialog title.
    await page.getByLabel('Deck', { exact: true }).click()
    await page.getByRole('option', { name: 'Turnierdeck' }).click()
    await page.getByRole('button', { name: 'Anmelden' }).click()

    await expect(organizerRow.getByText('Turnierdeck')).toBeVisible()
    await expect(organizerRow.getByText('Nicht legal')).toBeVisible()

    // --- Start the tournament -------------------------------------------------
    await page.getByRole('button', { name: 'Turnier starten' }).click()
    await expect(page.getByText('Läuft')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Runde 1' })).toBeVisible()
    await expect(page.getByText('Tisch 1')).toBeVisible()
    await expect(page.getByText('Tisch 2')).toBeVisible()

    // Seeds are 1 organizer, 2 Alice, 3 Bob, 4 Carla — table 1 is organizer vs
    // Alice, table 2 is Bob vs Carla. The A side wins both, 2:0.
    await matchRow(page, 1).getByRole('button', { name: '2:0' }).click()
    await matchRow(page, 2).getByRole('button', { name: '2:0' }).click()

    await expect(page.getByRole('button', { name: 'Runde abschließen' })).toBeEnabled()
    await page.getByRole('button', { name: 'Runde abschließen' }).click()

    const round1Collapsed = page.getByRole('button').filter({ hasText: 'Runde 1' })
    await expect(round1Collapsed).toContainText('Abgeschlossen')

    // --- Round 2: organizer vs Bob (both on 3 points), Alice vs Carla ---------
    await page.getByRole('button', { name: 'Nächste Runde' }).click()
    await expect(page.getByRole('heading', { name: 'Runde 2' })).toBeVisible()

    const round2Table1 = matchRow(page, 1)
    await round2Table1.getByLabel(`Spiele ${organizer.name}`).fill('2')
    await round2Table1.getByLabel('Spiele Bob').fill('1')
    await round2Table1.getByRole('button', { name: 'Ergebnis speichern' }).click()

    await matchRow(page, 2).getByRole('button', { name: '0:2' }).click()

    await expect(page.getByRole('button', { name: 'Runde abschließen' })).toBeEnabled()
    await page.getByRole('button', { name: 'Runde abschließen' }).click()

    // --- Finish the tournament -------------------------------------------------
    await page.getByRole('button', { name: 'Turnier abschließen' }).click()
    await acceptConfirm(page)
    await expect(page.getByText('Dieses Turnier ist abgeschlossen und kann nicht mehr geändert werden.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nächste Runde' })).toHaveCount(0)

    // --- Standings: organizer (6), Bob (3), Carla (3), Alice (0) --------------
    await expect(page.getByRole('columnheader', { name: 'Platz' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Punkte' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'OMW%' })).toBeVisible()

    // The "Tabelle" heading now shares its row with the "Sieger: …" line
    // (#36), so it's no longer the table's direct parent — scope by the
    // enclosing <section> instead of a fixed number of `..` hops.
    const standingsSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tabelle' }) })
    const standingsRows = standingsSection.locator('tbody tr')
    await expect(standingsRows).toHaveCount(4)

    // Columns are Platz, Spieler, Punkte, S-N-U, OMW%, GW%, OGW% — read the
    // name and points columns by index instead of matching the row's full
    // (unseparated) text, which concatenates "6" and "2-0-0" into "62-0-0".
    async function nameAndPoints(rowIndex: number) {
      const cells = standingsRows.nth(rowIndex).locator('td')
      return { name: await cells.nth(1).innerText(), points: (await cells.nth(2).innerText()).trim() }
    }

    expect(await nameAndPoints(0)).toEqual(expect.objectContaining({ points: '6' }))
    expect((await nameAndPoints(0)).name).toContain(organizer.name)
    expect(await nameAndPoints(1)).toEqual({ name: 'Bob', points: '3' })
    expect(await nameAndPoints(2)).toEqual({ name: 'Carla', points: '3' })
    expect(await nameAndPoints(3)).toEqual({ name: 'Alice', points: '0' })

    // --- History filter (#32: role and status are independent axes) ----------
    await page.goto('/turniere')
    // Default view is "Meine Turniere" + "Aktiv" — the now-finished tournament
    // is not an active one, so it's not here.
    await expect(page.getByRole('heading', { name: 'Freitagsturnier' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Abgeschlossen' }).click()
    await expect(page.getByRole('heading', { name: 'Freitagsturnier' })).toBeVisible()

    // The organizer also played in their own tournament ("Ich spiele selbst
    // mit"), so it stays visible under "Teilnahmen" too, still filtered to
    // "Abgeschlossen" — this used to require excluding the organizer's own
    // participant row.
    await page.getByRole('button', { name: 'Teilnahmen' }).click()
    await expect(page.getByRole('heading', { name: 'Freitagsturnier' })).toBeVisible()

    // --- Delete -----------------------------------------------------------------
    await page.getByRole('link', { name: 'Freitagsturnier' }).click()
    await expect(page).toHaveURL(/\/turniere\/[0-9a-f-]{36}$/)

    await page.getByRole('button', { name: 'Turnier löschen' }).click()
    await acceptConfirm(page)

    await expect(page).toHaveURL('/turniere')
    await expect(page.getByText('Noch keine Turniere')).toBeVisible()
  })

  test('a linked participant sees and joins a tournament without organizer actions', async ({ page, browser }) => {
    // Register participant B first, in an isolated browser context, so their
    // account exists before the organizer adds them by e-mail.
    const bContext = await browser.newContext()
    const bPage = await bContext.newPage()
    const participant = await registerAndLogin(bPage, { email: uniqueEmail(), name: 'Teilnehmerin B' })

    // Seed B's own deck for later self-registration.
    const bDeckResponse = await bPage.request.post('/api/decks', {
      data: {
        name: 'B-Deck',
        cards: [
          { catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 },
          { catalog_card_id: KURIBOH, section: 'main', quantity: 3 },
        ],
      },
    })
    expect(bDeckResponse.ok()).toBe(true)

    // Organizer creates the tournament and adds B by e-mail.
    const organizer = await registerAndLogin(page)
    await page.goto('/turniere/neu')
    await fillReliably(page.getByLabel('Turniername'), 'Einladungsturnier')
    await page.getByRole('button', { name: 'Turnier anlegen' }).click()
    await expect(page).toHaveURL(/\/turniere\/[0-9a-f-]{36}$/)
    const tournamentUrl = page.url()

    await page.getByRole('button', { name: 'Per E-Mail' }).click()
    await page.getByLabel('E-Mail-Adresse').fill(participant.email)
    await page.getByRole('button', { name: 'Teilnehmer hinzufügen' }).click()
    await expect(participantRow(page, participant.name)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Teilnehmer (2)' })).toBeVisible()

    // B sees the tournament under "Teilnahmen" and can open it.
    await bPage.goto('/turniere')
    await bPage.getByRole('button', { name: 'Teilnahmen' }).click()
    await expect(bPage.getByRole('heading', { name: 'Einladungsturnier' })).toBeVisible()

    await bPage.goto(tournamentUrl)
    await expect(bPage.getByRole('heading', { name: 'Einladungsturnier' })).toBeVisible()
    await expect(bPage.getByText('Du nimmst an diesem Turnier teil. Änderungen nimmt die Turnierleitung vor.')).toBeVisible()

    // B has no organizer-only actions and no add-participant form.
    await expect(bPage.getByRole('button', { name: 'Turnier starten' })).toHaveCount(0)
    await expect(bPage.getByRole('button', { name: 'Turnier löschen' })).toHaveCount(0)
    await expect(bPage.getByRole('button', { name: 'Teilnehmer hinzufügen' })).toHaveCount(0)

    // A linked participant without a registered deck sees a prominent
    // reminder before the tournament starts (#31).
    await expect(bPage.getByText('Melde dein Deck an, bevor das Turnier startet.')).toBeVisible()

    // B registers their own deck during registration.
    const bRow = participantRow(bPage, participant.name)
    await bRow.getByRole('button', { name: 'Deck anmelden' }).click()
    await bPage.getByLabel('Deck', { exact: true }).click()
    await bPage.getByRole('option', { name: 'B-Deck' }).click()
    await bPage.getByRole('button', { name: 'Anmelden' }).click()
    await expect(bRow.getByText('B-Deck')).toBeVisible()
    await expect(bPage.getByText('Melde dein Deck an, bevor das Turnier startet.')).toHaveCount(0)

    // B cannot register a deck for the organizer's row: no button on it.
    const organizerRowForB = participantRow(bPage, organizer.name)
    await expect(organizerRowForB.getByRole('button', { name: /Deck an/ })).toHaveCount(0)

    await bContext.close()
  })

  test('confirms before removing a participant and before finishing a tournament, and lets a cancelled confirm keep the previous state', async ({ page }) => {
    await registerAndLogin(page)

    await page.goto('/turniere/neu')
    await fillReliably(page.getByLabel('Turniername'), 'Bestätigungsturnier')
    await page.getByRole('button', { name: 'Turnier anlegen' }).click()
    await expect(page).toHaveURL(/\/turniere\/[0-9a-f-]{36}$/)

    await page.getByRole('button', { name: 'Als Gast' }).click()
    const guestNameField = page.getByLabel('Name')
    await fillReliably(guestNameField, 'Wegwerf Gast')
    await page.getByRole('button', { name: 'Teilnehmer hinzufügen' }).click()
    await expect(participantRow(page, 'Wegwerf Gast')).toBeVisible()

    // Cancelling "Entfernen" keeps the participant (#28).
    await page.getByRole('button', { name: 'Optionen für Wegwerf Gast' }).click()
    await page.getByRole('menuitem', { name: 'Entfernen' }).click()
    await cancelConfirm(page)
    await expect(participantRow(page, 'Wegwerf Gast')).toBeVisible()

    // Accepting it removes them.
    await page.getByRole('button', { name: 'Optionen für Wegwerf Gast' }).click()
    await page.getByRole('menuitem', { name: 'Entfernen' }).click()
    await acceptConfirm(page)
    await expect(participantRow(page, 'Wegwerf Gast')).toHaveCount(0)

    // Two participants and a completed round are needed to reach "Turnier
    // abschließen" — add one back and play it out.
    await expect(guestNameField).toHaveValue('')
    await fillReliably(guestNameField, 'Mitspieler')
    await page.getByRole('button', { name: 'Teilnehmer hinzufügen' }).click()
    await expect(participantRow(page, 'Mitspieler')).toBeVisible()

    await page.getByRole('button', { name: 'Turnier starten' }).click()
    await expect(page.getByText('Läuft')).toBeVisible()

    await matchRow(page, 1).getByRole('button', { name: '2:0' }).click()
    await page.getByRole('button', { name: 'Runde abschließen' }).click()

    // Cancelling "Turnier abschließen" leaves it running (#27).
    await page.getByRole('button', { name: 'Turnier abschließen' }).click()
    await cancelConfirm(page)
    await expect(page.getByText('Läuft')).toBeVisible()

    // Accepting it finishes the tournament.
    await page.getByRole('button', { name: 'Turnier abschließen' }).click()
    await acceptConfirm(page)
    await expect(page.getByText('Dieses Turnier ist abgeschlossen und kann nicht mehr geändert werden.')).toBeVisible()

    // The winner is called out next to the standings (#36).
    await expect(page.getByText(/Sieger: /)).toBeVisible()
  })
})
