import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DashboardPage from '~/pages/index.vue'

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
})
