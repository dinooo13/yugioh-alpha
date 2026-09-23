import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import TournamentsPage from '~/pages/tournaments/index.vue'
import type { TournamentListItem, TournamentListResponse } from '~~/shared/tournaments'

const state = vi.hoisted(() => ({
  list: { items: [] as TournamentListItem[], total: 0, page: 1, pageSize: 20 } as TournamentListResponse,
  // The "other role" count-only fetch (pageSize: 1) used to label the tab
  // the user isn't currently on and to drive the empty-state hint.
  otherList: { items: [] as TournamentListItem[], total: 0, page: 1, pageSize: 1 } as TournamentListResponse,
  // Captured queries are computed refs, so their `.value` keeps reflecting
  // the page's reactive filter state after the fact.
  lastQueryRef: undefined as { value: Record<string, unknown> } | undefined,
  otherQueryRef: undefined as { value: Record<string, unknown> } | undefined,
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string), options?: { query?: { value: Record<string, unknown> } }) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/tournaments') {
      const query = options?.query
      // The count-only fetch always asks for pageSize 1; distinguish it from
      // the main list fetch so tests can control each independently.
      if (query?.value?.pageSize === 1) {
        state.otherQueryRef = query
        return { data: ref(state.otherList), pending: ref(false), refresh: vi.fn() }
      }
      state.lastQueryRef = query
      return { data: ref(state.list), pending: ref(false), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), refresh: vi.fn() }
  }
})

function item(overrides: Partial<TournamentListItem> = {}): TournamentListItem {
  return {
    id: 'tournament-1',
    name: 'Freitagsturnier',
    description: null,
    status: 'registration',
    pairingSystem: 'swiss',
    format: null,
    organizerName: 'Alice',
    role: 'organizer',
    participantCount: 4,
    roundCount: 1,
    plannedRounds: 3,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    updatedAt: '2025-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('tournaments page', () => {
  it('renders the role tabs, the status toggle and the create button', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Meine Turniere')
    expect(text).toContain('Teilnahmen')
    expect(text).toContain('Aktiv')
    expect(text).toContain('Abgeschlossen')
    expect(text).toContain('Neues Turnier')
  })

  it('labels each role tab with its tournament count', async () => {
    state.list = { items: [item()], total: 1, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 3, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Meine Turniere (1)')
    expect(text).toContain('Teilnahmen (3)')
  })

  it('renders the status badge, participant count and round progress', async () => {
    state.list = {
      items: [item({ status: 'running', roundCount: 1, plannedRounds: 3, participantCount: 4 })],
      total: 1,
      page: 1,
      pageSize: 20,
    }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Läuft')
    expect(text).toContain('4 Teilnehmer')
    expect(text).toContain('Runde 1/3')
  })

  it('shows the organizer empty state and switches to the participant empty state', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)

    expect(component.text()).toContain('Noch keine Turniere')

    await component.findAll('button').find(button => button.text().startsWith('Teilnahmen'))!.trigger('click')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Keine Teilnahmen')
  })

  it('hints at "Teilnahmen" when "Meine Turniere" is empty but participations exist', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 1, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    const text = component.text()

    expect(text).toContain('Noch keine Turniere')
    expect(text).toContain('Du nimmst an 1 Turnier teil.')
    expect(text).toContain('Eingeladene Turniere ansehen')
  })

  it('shows an abgeschlossen-specific empty state when the status toggle is switched', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)
    await component.findAll('button').find(button => button.text() === 'Abgeschlossen')!.trigger('click')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Noch keine abgeschlossenen Turniere')
  })

  it('updates the query sent to useFetch when role or status changes, keeping the two axes independent', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }
    state.otherList = { items: [], total: 0, page: 1, pageSize: 1 }

    const component = await mountSuspended(TournamentsPage)

    expect(state.lastQueryRef?.value).toEqual({ role: 'organizer', status: 'active', page: 1, pageSize: 20 })

    await component.findAll('button').find(button => button.text().startsWith('Teilnahmen'))!.trigger('click')
    await component.vm.$nextTick()

    expect(state.lastQueryRef?.value).toEqual({ role: 'participant', status: 'active', page: 1, pageSize: 20 })

    // The status toggle is independent of the role tab: switching it keeps
    // the role that was already selected (#32 — these used to be a single
    // mixed axis).
    await component.findAll('button').find(button => button.text() === 'Abgeschlossen')!.trigger('click')
    await component.vm.$nextTick()

    expect(state.lastQueryRef?.value).toEqual({ role: 'participant', status: 'finished', page: 1, pageSize: 20 })
  })
})
