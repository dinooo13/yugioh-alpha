import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DashboardPage from '~/pages/index.vue'
import { setTestLocale } from './fixtures/locale'

const state = vi.hoisted(() => ({
  collections: { items: [] as unknown[], allCount: 0 },
  decks: { total: 0 },
  tournaments: { total: 0 },
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/collections') {
      return { data: ref(state.collections), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/decks') {
      return { data: ref(state.decks), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    if (resolvedUrl === '/api/tournaments') {
      return { data: ref(state.tournaments), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

afterEach(() => setTestLocale('de'))

describe('dashboard page', () => {
  it('shows a first-run hint and zero counts for a brand-new account', async () => {
    state.collections = { items: [], allCount: 0 }
    state.decks = { total: 0 }
    state.tournaments = { total: 0 }

    const component = await mountSuspended(DashboardPage)
    const text = component.text()

    expect(text).toContain('Dashboard')
    expect(text).toContain("Los geht's")
    expect(text).toContain('Karten erfassen')
    expect(text).toContain('Deck anlegen')
    expect(text).toContain('Turnier anlegen')
  })

  it('shows real counts and hides the first-run hint once there is data', async () => {
    state.collections = { items: [], allCount: 42 }
    state.decks = { total: 3 }
    state.tournaments = { total: 1 }

    const component = await mountSuspended(DashboardPage)
    const text = component.text()

    expect(text).not.toContain("Los geht's")
    expect(text).toContain('42')
    expect(text).toContain('3 angelegte Decks')
    expect(text).toContain('1 Turnier')
  })

  it('uses the singular for exactly one and the plural for zero', async () => {
    state.collections = { items: [], allCount: 1 }
    state.decks = { total: 1 }
    state.tournaments = { total: 0 }

    const text = (await mountSuspended(DashboardPage)).text()

    expect(text).toContain('1 Karte im Bestand')
    expect(text).toContain('1 angelegtes Deck')
    expect(text).toContain('0 Turniere')
  })

  it('makes each whole card a link to its list; the quick action stays a separate link above it (#134)', async () => {
    state.collections = { items: [], allCount: 5 }
    state.decks = { total: 2 }
    state.tournaments = { total: 1 }

    const component = await mountSuspended(DashboardPage)
    const articles = component.findAll('article')
    expect(articles).toHaveLength(3)

    const expected = [
      { list: '/inventory', title: 'Inventar', cta: '/inventory/quick-entry' },
      { list: '/decks', title: 'Decks', cta: '/decks?new=1' },
      { list: '/tournaments', title: 'Turniere', cta: '/tournaments/new' },
    ]
    articles.forEach((article, index) => {
      const { list, title, cta } = expected[index]!
      const stretched = article.findAll('a.stretched-link')
      expect(stretched).toHaveLength(1)
      expect(stretched[0]!.attributes('href')).toBe(list)
      expect(stretched[0]!.text()).toBe(title)

      const action = article.find(`a[href="${cta}"]`)
      expect(action.exists()).toBe(true)
      expect(action.classes()).toContain('z-10')
      expect(stretched[0]!.element.contains(action.element)).toBe(false)
    })
  })

  it('renders in English with English plurals', async () => {
    await setTestLocale('en')
    state.collections = { items: [], allCount: 1 }
    state.decks = { total: 3 }
    state.tournaments = { total: 0 }

    const text = (await mountSuspended(DashboardPage)).text()

    expect(text).toContain('Welcome to YGO Alpha')
    expect(text).toContain('1 card in stock')
    expect(text).toContain('3 decks created')
    expect(text).toContain('0 tournaments')
    expect(text).toContain('Create deck')
  })

  it('formats the count with the locale\'s number format (it wins over the raw plural count)', async () => {
    state.collections = { items: [], allCount: 1234 }
    state.decks = { total: 0 }
    state.tournaments = { total: 0 }

    expect((await mountSuspended(DashboardPage)).text()).toContain('1.234 Karten im Bestand')

    await setTestLocale('en')
    expect((await mountSuspended(DashboardPage)).text()).toContain('1,234 cards in stock')
  })
})
