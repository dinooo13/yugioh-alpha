import { expect, test } from '@playwright/test'
import { logout, registerAndLogin, uniqueEmail } from './helpers/auth'

// Passcodes from the seeded E2E catalog fixture
// (server/db/fixtures/catalog-fixture.ts).
const DARK_MAGICIAN = 46986414

test.describe('sharing', () => {
  test('a deck shared by link opens anonymously, and 404s once the token is stripped', async ({ page }) => {
    await registerAndLogin(page)

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: 'Geteiltes Deck',
        cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json()

    await page.goto(`/decks/${deck.id}`)
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.getByRole('radio', { name: 'Nur über Link' }).click()

    // Read the link from the modal's read-only input, never from the
    // clipboard — clipboard permissions are not guaranteed in CI.
    const linkInput = page.getByLabel('Freigabe-Link')
    await expect(linkInput).not.toHaveValue('')
    await page.getByRole('button', { name: 'Link kopieren' }).click()
    const shareUrl = await linkInput.inputValue()

    // Close the modal before logging out — it still covers the sidebar.
    await page.keyboard.press('Escape')
    await logout(page)

    await page.goto(shareUrl)
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Geteiltes Deck' })).toBeVisible()
    await expect(page.getByText('Geteilt von', { exact: false })).toBeVisible()
    await expect(page.getByText('Dark Magician')).toBeVisible()
    await expect(page.getByText('3×')).toBeVisible()
    await expect(page.getByText('fehlt')).toHaveCount(0)

    // Strip the token: the link no longer resolves.
    await page.goto(shareUrl.split('?')[0])
    await expect(page.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()
  })

  test('a deck can be granted to a selected user, and the grant can be revoked', async ({ page, browser }) => {
    await registerAndLogin(page)
    const profileA = await (await page.request.get('/api/profile')).json()

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: 'Privates Deck',
        cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json()

    // User B, discovered through the profile — a second, independent context
    // so A and B never share a session.
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    await registerAndLogin(pageB, { email: uniqueEmail() })
    const profileB = await (await pageB.request.get('/api/profile')).json()

    // A opens the deck's share modal, keeps it private, and grants access to B.
    await page.goto(`/decks/${deck.id}`)
    await page.getByRole('button', { name: 'Teilen' }).click()
    await expect(page.getByRole('radio', { name: 'Privat' })).toBeChecked()

    await page.getByLabel('Spieler suchen').fill(profileB.handle)
    await page.getByRole('button', { name: 'Hinzufügen' }).click()
    await expect(page.getByText(`@${profileB.handle}`)).toBeVisible()

    // "Privat" no longer claims only the owner can see it once a grant
    // exists (UX review #20).
    await expect(page.getByText('Nur du und 1 freigegebener Spieler können das sehen.')).toBeVisible()

    // B finds the deck on A's profile and opens it read-only. The deck's
    // name is also a heading on this very profile page, so the navigation
    // itself — not just the heading text — has to be awaited before reading
    // `pageB.url()` below.
    await pageB.goto(`/players/${profileA.handle}`)
    await expect(pageB.getByRole('heading', { name: 'Privates Deck' })).toBeVisible()
    await pageB.getByRole('link', { name: 'Privates Deck' }).click()
    await expect(pageB).toHaveURL(/\/players\/.+\/decks\//)

    await expect(pageB.getByRole('heading', { name: 'Privates Deck' })).toBeVisible()
    await expect(pageB.getByText('Teilen', { exact: true })).toHaveCount(0)
    await expect(pageB.getByText('Bearbeiten', { exact: true })).toHaveCount(0)
    const deckUrlB = pageB.url()

    // A removes the grant; B's link now 404s.
    await page.getByRole('button', { name: 'Entfernen' }).click()
    await expect(page.getByText('Noch keine Spieler freigegeben.')).toBeVisible()

    await pageB.goto(deckUrlB)
    await expect(pageB.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()

    await contextB.close()
  })

  test('the whole inventory can be compared publicly and hidden again', async ({ page, browser }) => {
    await registerAndLogin(page)
    const profileA = await (await page.request.get('/api/profile')).json()

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 2 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    await page.goto('/profile')
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.getByRole('radio', { name: 'Öffentlich' }).click()
    await expect(page.getByRole('radio', { name: 'Öffentlich' })).toBeChecked()

    const anonContext = await browser.newContext()
    const anonPage = await anonContext.newPage()

    await anonPage.goto(`/players/${profileA.handle}`)
    await expect(anonPage.getByRole('heading', { name: 'Inventar' })).toBeVisible()
    await anonPage.getByRole('link', { name: 'Inventar ansehen' }).click()

    // The shared inventory names its owner in both the H1 and the <title>
    // (UX review #24) — "Alle Karten" told a visitor nothing.
    await expect(anonPage.getByRole('heading', { name: 'Inventar von E2E Test User' })).toBeVisible()
    await expect(anonPage).toHaveTitle('Inventar von E2E Test User – yugioh alpha')

    await expect(anonPage.getByText('Dark Magician')).toBeVisible()
    await expect(anonPage.getByText('2×')).toBeVisible()

    await anonPage.getByLabel('Karten durchsuchen').fill('Blue')
    await expect(anonPage.getByText('Dark Magician')).toHaveCount(0)

    // A hides the inventory again; the anonymous page then 404s.
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.getByRole('radio', { name: 'Privat' }).click()
    await expect(page.getByRole('radio', { name: 'Privat' })).toBeChecked()

    await anonPage.goto(`/players/${profileA.handle}/inventory`)
    await expect(anonPage.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()

    await anonContext.close()
  })

  test('a granted user who is signed out is offered a login link that returns them to the shared deck', async ({ page, browser }) => {
    await registerAndLogin(page)
    const profileA = await (await page.request.get('/api/profile')).json()

    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { catalog_card_id: DARK_MAGICIAN, quantity: 3 },
    })
    expect(inventoryResponse.ok()).toBe(true)

    const deckResponse = await page.request.post('/api/decks', {
      data: {
        name: 'Deck für B ohne Session',
        cards: [{ catalog_card_id: DARK_MAGICIAN, section: 'main', quantity: 3 }],
      },
    })
    expect(deckResponse.ok()).toBe(true)
    const deck = await deckResponse.json()

    // User B is registered (so a grant can target them), then signed out —
    // the whole point of this test is what an anonymous grantee sees.
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    const userB = await registerAndLogin(pageB, { email: uniqueEmail() })
    const profileB = await (await pageB.request.get('/api/profile')).json()
    await logout(pageB)

    await page.goto(`/decks/${deck.id}`)
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.getByLabel('Spieler suchen').fill(profileB.handle)
    await page.getByRole('button', { name: 'Hinzufügen' }).click()
    await expect(page.getByText(`@${profileB.handle}`)).toBeVisible()

    const deckPath = `/players/${profileA.handle}/decks/${deck.id}`

    // Signed out, B's grant is invisible to the server (grants are
    // user-bound) — the not-found box is correct, but it must not read like
    // a dead end (UX review #19).
    await pageB.goto(deckPath)
    await expect(pageB.getByText('Nicht gefunden oder nicht freigegeben.')).toBeVisible()

    const loginLink = pageB.getByRole('link', { name: 'melde dich an' })
    await expect(loginLink).toBeVisible()

    await loginLink.click()
    await expect(pageB).toHaveURL(/\/login\?redirect=/)
    expect(new URL(pageB.url()).searchParams.get('redirect')).toBe(deckPath)

    await pageB.getByLabel('E-Mail').fill(userB.email)
    await pageB.getByLabel('Passwort').fill(userB.password)
    await pageB.getByRole('button', { name: 'Anmelden' }).click()

    // Signed in, the same grant now resolves — landing back on the deck the
    // login link was clicked from, not the dashboard.
    await expect(pageB).toHaveURL(deckPath)
    await expect(pageB.getByRole('heading', { name: 'Deck für B ohne Session' })).toBeVisible()

    await contextB.close()
  })
})
