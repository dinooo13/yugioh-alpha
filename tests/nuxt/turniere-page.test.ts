import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import TurnierePage from '~/pages/turniere/index.vue'
import type { TournamentListItem } from '~~/shared/tournaments'

const state = vi.hoisted(() => ({
  list: { items: [] as TournamentListItem[], total: 0, page: 1, pageSize: 20 },
  // The captured query is a computed ref, so its `.value` keeps reflecting
  // the page's reactive filter state after the fact.
  lastQueryRef: undefined as { value: Record<string, unknown> } | undefined,
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string), options?: { query?: { value: Record<string, unknown> } }) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/tournaments') {
      state.lastQueryRef = options?.query
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

describe('turniere page', () => {
  it('renders the three filter buttons and the create button', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }

    const component = await mountSuspended(TurnierePage)
    const text = component.text()

    expect(text).toContain('Meine Turniere')
    expect(text).toContain('Teilnahmen')
    expect(text).toContain('Abgeschlossen')
    expect(text).toContain('Neues Turnier')
  })

  it('renders the status badge, participant count and round progress', async () => {
    state.list = {
      items: [item({ status: 'running', roundCount: 1, plannedRounds: 3, participantCount: 4 })],
      total: 1,
      page: 1,
      pageSize: 20,
    }

    const component = await mountSuspended(TurnierePage)
    const text = component.text()

    expect(text).toContain('Läuft')
    expect(text).toContain('4 Teilnehmer')
    expect(text).toContain('Runde 1/3')
  })

  it('shows the organizer empty state and switches to the participant empty state', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }

    const component = await mountSuspended(TurnierePage)

    expect(component.text()).toContain('Noch keine Turniere')

    await component.findAll('button').find(button => button.text() === 'Teilnahmen')!.trigger('click')
    await component.vm.$nextTick()

    expect(component.text()).toContain('Keine Teilnahmen')
  })

  it('updates the query sent to useFetch when the filter changes', async () => {
    state.list = { items: [], total: 0, page: 1, pageSize: 20 }

    const component = await mountSuspended(TurnierePage)

    expect(state.lastQueryRef?.value).toEqual({ role: 'organizer', status: 'active', page: 1, pageSize: 20 })

    await component.findAll('button').find(button => button.text() === 'Teilnahmen')!.trigger('click')
    await component.vm.$nextTick()

    expect(state.lastQueryRef?.value).toEqual({ role: 'participant', status: 'active', page: 1, pageSize: 20 })

    await component.findAll('button').find(button => button.text() === 'Abgeschlossen')!.trigger('click')
    await component.vm.$nextTick()

    expect(state.lastQueryRef?.value).toEqual({ status: 'finished', page: 1, pageSize: 20 })
  })
})
