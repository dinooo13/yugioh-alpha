import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import TournamentDetailPage from '~/pages/tournaments/[id].vue'
import type {
  TournamentDeckSnapshot,
  TournamentDetail,
  TournamentMatchDto,
  TournamentParticipantDto,
  TournamentRoundDto,
  TournamentStandingRow,
} from '~~/shared/tournaments'
import { setTestLocale } from './fixtures/locale'

const state = vi.hoisted(() => ({
  tournament: {} as TournamentDetail,
  getCallCount: 0,
}))

mockNuxtImport('useFetch', () => {
  return (url: string | (() => string)) => {
    const resolvedUrl = typeof url === 'function' ? url() : url
    if (resolvedUrl === '/api/tournaments/t-1') {
      state.getCallCount += 1
      return { data: ref(state.tournament), pending: ref(false), error: ref(null), refresh: vi.fn() }
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  }
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/tournaments/t-1', params: { id: 't-1' }, query: {} })
})

function participant(overrides: Partial<TournamentParticipantDto> = {}): TournamentParticipantDto {
  return {
    id: 'p-1',
    name: 'Organizer',
    linked: true,
    isSelf: true,
    dropped: false,
    seed: 1,
    deckId: null,
    deckName: null,
    deckLegal: null,
    deckIssueCount: null,
    deckSnapshot: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function match(overrides: Partial<TournamentMatchDto> = {}): TournamentMatchDto {
  return {
    id: 'm-1',
    roundId: 'r-1',
    roundNumber: 1,
    tableNumber: 1,
    participantAId: 'p-1',
    participantAName: 'Organizer',
    participantBId: 'p-2',
    participantBName: 'Alice',
    winnerParticipantId: null,
    gamesA: 0,
    gamesB: 0,
    isDraw: false,
    isBye: false,
    reported: false,
    reportedAt: null,
    ...overrides,
  }
}

function round(overrides: Partial<TournamentRoundDto> = {}): TournamentRoundDto {
  return {
    id: 'r-1',
    number: 1,
    status: 'pending',
    matches: [match()],
    createdAt: '2025-01-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

function standing(overrides: Partial<TournamentStandingRow> = {}): TournamentStandingRow {
  return {
    participantId: 'p-1',
    rank: 1,
    matchesPlayed: 1,
    wins: 1,
    losses: 0,
    draws: 0,
    byes: 0,
    points: 3,
    gamesWon: 2,
    gamesLost: 0,
    matchWinRate: 1,
    gameWinRate: 1,
    opponentMatchWinRate: 0.6667,
    opponentGameWinRate: 0.6,
    dropped: false,
    name: 'Organizer',
    ...overrides,
  }
}

function tournamentDetail(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: 't-1',
    name: 'Freitagsturnier',
    description: null,
    status: 'registration',
    pairingSystem: 'swiss',
    plannedRounds: null,
    format: null,
    organizerName: 'Organizer',
    role: 'organizer',
    selfParticipantId: 'p-1',
    participants: [participant()],
    rounds: [],
    currentRound: null,
    standings: [],
    canStart: false,
    canCreateRound: false,
    canCompleteRound: false,
    canFinish: false,
    canEditPairings: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  state.getCallCount = 0
  await setTestLocale('de')
})


describe('tournament detail page — organizer, registration', () => {
  it('disables "Turnier starten" with one participant and enables it with two', async () => {
    state.tournament = tournamentDetail({ participants: [participant()], canStart: false })

    const component = await mountSuspended(TournamentDetailPage)
    const startButton = component.findAll('button').find(button => button.text() === 'Turnier starten')
    expect(startButton?.attributes('disabled')).toBeDefined()

    state.tournament = tournamentDetail({
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      canStart: true,
    })
    const component2 = await mountSuspended(TournamentDetailPage)
    const startButton2 = component2.findAll('button').find(button => button.text() === 'Turnier starten')
    expect(startButton2?.attributes('disabled')).toBeUndefined()
  })

  it('spells out why "Turnier starten" is disabled as visible text, not only a tooltip', async () => {
    state.tournament = tournamentDetail({ participants: [participant()], canStart: false })

    const component = await mountSuspended(TournamentDetailPage)
    const hint = component.findAll('p').find(p => p.text() === 'Mindestens 2 Teilnehmer nötig')
    expect(hint).toBeTruthy()

    state.tournament = tournamentDetail({
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      canStart: true,
    })
    const component2 = await mountSuspended(TournamentDetailPage)
    expect(component2.text()).not.toContain('Mindestens 2 Teilnehmer nötig')
  })

  it('shows the add-participant form and a legality badge with issue count', async () => {
    state.tournament = tournamentDetail({
      participants: [
        participant({
          deckId: 'deck-1',
          deckName: 'Turnierdeck',
          deckLegal: false,
          deckIssueCount: 2,
        }),
      ],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).toContain('Teilnehmer hinzufügen')
    expect(text).toContain('Deck ändern')
    expect(text).toContain('Nicht legal')
    expect(text).toContain('2 Regelverstöße')
  })

  it('keeps showing the registered deck name and legality badge once the underlying deck is deleted', async () => {
    // deck.deck_id is ON DELETE SET NULL: deckId goes null but the
    // snapshot-derived deckName/deckLegal/deckIssueCount survive. The panel
    // must key off deckName, not deckId, or a deleted deck silently drops
    // out of a running/finished tournament's participant list.
    state.tournament = tournamentDetail({
      participants: [
        participant({
          deckId: null,
          deckName: 'Turnierdeck',
          deckLegal: false,
          deckIssueCount: 2,
        }),
      ],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).toContain('Turnierdeck')
    expect(text).toContain('Nicht legal')
    expect(text).toContain('2 Regelverstöße')
    expect(text).not.toContain('Kein Deck')
    // deckId is null, so there is nothing left to preselect — the button
    // still reads "Deck ändern" because the participant is registered.
    expect(text).toContain('Deck ändern')
  })
})

describe('tournament detail page — mobile cards and legends (#28)', () => {
  it('explains the "Konto" badge in a legend when a linked participant is listed', async () => {
    state.tournament = tournamentDetail({
      participants: [participant(), participant({ id: 'p-2', name: 'Gast Anton', linked: false, isSelf: false })],
    })

    const component = await mountSuspended(TournamentDetailPage)

    expect(component.text()).toContain('„Konto“: Spieler mit eigenem Benutzerkonto')
    expect(component.text()).toContain('Gäste ohne Konto verwaltet die Turnierleitung.')
  })

  it('omits the "Konto" legend when every participant is a guest', async () => {
    state.tournament = tournamentDetail({
      selfParticipantId: null,
      participants: [
        participant({ id: 'p-1', name: 'Gast Anton', linked: false, isSelf: false }),
        participant({ id: 'p-2', name: 'Gast Berta', linked: false, isSelf: false }),
      ],
    })

    const component = await mountSuspended(TournamentDetailPage)

    expect(component.text()).not.toContain('„Konto“')
  })

  it('gives the row deck button a 44px touch target', async () => {
    state.tournament = tournamentDetail({
      participants: [participant({ deckId: 'deck-1', deckName: 'Turnierdeck' })],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const deckButton = component.findAll('button').find(button => button.text() === 'Deck ändern')

    expect(deckButton?.classes()).toContain('tap-target')
  })

  it('gives the result and swap controls 44px touch targets', async () => {
    state.tournament = tournamentDetail({
      status: 'running',
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      rounds: [round()],
      currentRound: round(),
      canEditPairings: true,
    })

    const component = await mountSuspended(TournamentDetailPage)
    const buttonByText = (label: string) => component.findAll('button').find(button => button.text() === label)

    expect(buttonByText('2:0')?.classes()).toContain('tap-target')
    expect(buttonByText('Ergebnis speichern')?.classes()).toContain('tap-target')
    expect(buttonByText('Paarungen tauschen')?.classes()).toContain('tap-target')
    expect(component.find('[aria-label="Spiele Organizer"]').classes()).toContain('tap-target')
  })

  it('spells out S-N-U in a visible legend, as an abbreviation title and in the phone card', async () => {
    state.tournament = tournamentDetail({
      status: 'finished',
      finishedAt: '2025-01-05T00:00:00.000Z',
      standings: [standing()],
    })

    const component = await mountSuspended(TournamentDetailPage)

    expect(component.text()).toContain('S-N-U = Siege–Niederlagen–Unentschieden')
    expect(component.text()).toContain('Punkte: Sieg 3, Unentschieden 1')
    expect(component.find('abbr[title="Siege–Niederlagen–Unentschieden"]').exists()).toBe(true)

    // Phone card: the tie-breakers repeated as a definition list.
    const cardStats = component.find('tbody dl')
    expect(cardStats.exists()).toBe(true)
    expect(cardStats.text()).toContain('S-N-U')
    expect(cardStats.text()).toContain('1-0-0')
    expect(cardStats.text()).toContain('66,7 %')
  })
})

describe('tournament detail page — organizer, running', () => {
  function runningTournament() {
    return tournamentDetail({
      status: 'running',
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      rounds: [round()],
      currentRound: round(),
      canCompleteRound: false,
    })
  }

  it('shows the current round, table, names and result inputs', async () => {
    state.tournament = runningTournament()

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).toContain('Runde 1')
    expect(text).toContain('Tisch 1')
    expect(text).toContain('Organizer')
    expect(text).toContain('Alice')
    expect(component.find('[aria-label="Spiele Organizer"]').exists()).toBe(true)
    expect(component.find('[aria-label="Spiele Alice"]').exists()).toBe(true)
  })

  it('disables "Runde abschließen" while a result is missing', async () => {
    state.tournament = runningTournament()

    const component = await mountSuspended(TournamentDetailPage)
    const completeButton = component.findAll('button').find(button => button.text() === 'Runde abschließen')
    expect(completeButton?.attributes('disabled')).toBeDefined()
  })

  it('reports a quick 2:0 result via PATCH and renders the returned detail without a second GET', async () => {
    state.tournament = runningTournament()

    const updated = runningTournament()
    updated.rounds = [round({ matches: [match({ gamesA: 2, gamesB: 0, winnerParticipantId: 'p-1', reported: true, reportedAt: '2025-01-03T00:00:00.000Z' })] })]
    updated.currentRound = updated.rounds[0]!
    updated.canCompleteRound = true

    const fetchMock = vi.fn((url: string) => (
      url === '/api/tournaments/t-1/matches/m-1' ? Promise.resolve(updated) : Promise.resolve(null)
    ))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(TournamentDetailPage)
    expect(state.getCallCount).toBe(1)

    const quickWinButton = component.findAll('button').find(button => button.text() === '2:0')
    await quickWinButton!.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/t-1/matches/m-1', {
      method: 'PATCH',
      body: { gamesA: 2, gamesB: 0 },
    })
    expect(component.text()).toContain('2:0')
    expect(component.text()).toContain('Sieg Organizer')
    // No second read of the tournament — the mutation response replaces the state directly.
    expect(state.getCallCount).toBe(1)
  })

  it('renders a bye without result inputs', async () => {
    const tournament = runningTournament()
    tournament.rounds = [round({
      matches: [match({
        id: 'm-bye',
        participantBId: null,
        participantBName: null,
        isBye: true,
        reported: true,
        gamesA: 2,
        gamesB: 0,
        winnerParticipantId: 'p-1',
        reportedAt: '2025-01-03T00:00:00.000Z',
      })],
    })]
    tournament.currentRound = tournament.rounds[0]!
    state.tournament = tournament

    const component = await mountSuspended(TournamentDetailPage)

    expect(component.text()).toContain('Freilos')
    expect(component.find('[aria-label="Spiele Organizer"]').exists()).toBe(false)
  })
})

describe('tournament detail page — standings', () => {
  it('renders standings in API order with formatted rates and a dropped badge', async () => {
    state.tournament = tournamentDetail({
      status: 'finished',
      finishedAt: '2025-01-05T00:00:00.000Z',
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false, dropped: true })],
      standings: [
        standing({ participantId: 'p-1', rank: 1, name: 'Organizer', opponentMatchWinRate: 0.6667 }),
        standing({ participantId: 'p-2', rank: 2, name: 'Alice', points: 0, wins: 0, losses: 1, dropped: true }),
      ],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const rows = component.findAll('tbody tr')
    const standingsRows = rows.filter(row => row.text().includes('Organizer') || row.text().includes('Alice'))

    expect(standingsRows[standingsRows.length - 2]?.text()).toContain('Organizer')
    expect(standingsRows[standingsRows.length - 1]?.text()).toContain('Alice')
    expect(component.text()).toContain('66,7 %')
    expect(component.text()).toContain('Ausgestiegen')
  })
})

describe('tournament detail page — participant role', () => {
  it('hides organizer-only controls, shows the participant banner, and reminds an undecked linked participant to register (#31)', async () => {
    state.tournament = tournamentDetail({
      role: 'participant',
      selfParticipantId: 'p-2',
      participants: [
        participant({ id: 'p-1', name: 'Organizer', isSelf: false }),
        participant({ id: 'p-2', name: 'Alice', isSelf: true }),
      ],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).not.toContain('Turnier starten')
    expect(text).not.toContain('Nächste Runde')
    expect(text).not.toContain('Teilnehmer hinzufügen')
    expect(text).toContain('Du nimmst an diesem Turnier teil')
    expect(text).toContain('Melde dein Deck an, bevor das Turnier startet.')

    // One "Deck anmelden" button in the reminder banner, one on Alice's own row.
    const deckButtons = component.findAll('button').filter(button => button.text() === 'Deck anmelden')
    expect(deckButtons).toHaveLength(2)
  })

  it('does not show the deck reminder once the participant has registered a deck', async () => {
    state.tournament = tournamentDetail({
      role: 'participant',
      selfParticipantId: 'p-2',
      participants: [
        participant({ id: 'p-1', name: 'Organizer', isSelf: false }),
        participant({ id: 'p-2', name: 'Alice', isSelf: true, deckId: 'deck-1', deckName: 'Alice-Deck' }),
      ],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).not.toContain('Melde dein Deck an, bevor das Turnier startet.')
    expect(component.findAll('button').filter(button => button.text() === 'Deck anmelden')).toHaveLength(0)
    expect(component.findAll('button').filter(button => button.text() === 'Deck ändern')).toHaveLength(1)
  })
})

describe('tournament detail page — finished', () => {
  it('shows the read-only banner, hides state-transition actions, and still renders standings', async () => {
    state.tournament = tournamentDetail({
      status: 'finished',
      finishedAt: '2025-01-05T00:00:00.000Z',
      standings: [standing()],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).toContain('Dieses Turnier ist abgeschlossen und kann nicht mehr geändert werden.')
    expect(text).not.toContain('Turnier starten')
    expect(text).not.toContain('Nächste Runde')
    expect(text).not.toContain('Runde abschließen')
    expect(text).not.toContain('Turnier abschließen')
    expect(text).toContain('Tabelle')
    expect(text).toContain('Organizer')
  })

  it('leads with the final table and drops the empty "Aktionen" column', async () => {
    state.tournament = tournamentDetail({
      status: 'finished',
      finishedAt: '2025-01-05T00:00:00.000Z',
      standings: [standing()],
    })

    const component = await mountSuspended(TournamentDetailPage)
    const headings = component.findAll('h2').map(heading => heading.text())
    const tableIndex = headings.findIndex(heading => heading.startsWith('Tabelle'))
    const participantsIndex = headings.findIndex(heading => heading.startsWith('Teilnehmer'))

    expect(tableIndex).toBeGreaterThanOrEqual(0)
    expect(participantsIndex).toBeGreaterThan(tableIndex)
    expect(headings.filter(heading => heading.startsWith('Tabelle'))).toHaveLength(1)
    expect(component.findAll('th').map(th => th.text())).not.toContain('Aktionen')
  })
})

describe('tournament detail page — error mapping', () => {
  it('maps a machine-readable error code to its German message', async () => {
    state.tournament = tournamentDetail({
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      canStart: true,
    })

    // Mirrors ofetch's real shape: `error.data` is the JSON body Nitro's
    // `createError` serialized, i.e. `{ statusCode, statusMessage, data: { code, params } }`.
    const fetchMock = vi.fn(() => Promise.reject(notEnoughParticipantsError()))
    vi.stubGlobal('$fetch', fetchMock)

    const component = await mountSuspended(TournamentDetailPage)
    await component.findAll('button').find(button => button.text() === 'Turnier starten')!.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Mindestens 2 Teilnehmer sind nötig.')
  })

  it('translates the error code in English, with its params, and never shows the statusMessage', async () => {
    await setTestLocale('en')
    state.tournament = tournamentDetail({
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      canStart: true,
    })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject(notEnoughParticipantsError())))

    const component = await mountSuspended(TournamentDetailPage)
    await component.findAll('button').find(button => button.text() === 'Start tournament')!.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('At least 2 participants are needed.')
    expect(component.text()).not.toContain('Not enough participants')
  })

  it('falls back to the action\'s own message for an error without a known code', async () => {
    state.tournament = tournamentDetail({
      participants: [participant(), participant({ id: 'p-2', name: 'Alice', isSelf: false })],
      canStart: true,
    })
    vi.stubGlobal('$fetch', vi.fn(() => Promise.reject({
      data: { statusCode: 500, statusMessage: 'Internal Server Error' },
    })))

    const component = await mountSuspended(TournamentDetailPage)
    await component.findAll('button').find(button => button.text() === 'Turnier starten')!.trigger('click')
    await flushPromises()
    await component.vm.$nextTick()

    expect(component.text()).toContain('Das Turnier konnte nicht gestartet werden.')
    expect(component.text()).not.toContain('Internal Server Error')
  })
})

function notEnoughParticipantsError() {
  return {
    data: {
      statusCode: 409,
      statusMessage: 'Not enough participants',
      data: { code: 'not_enough_participants', params: { min: 2 } },
    },
  }
}

function snapshot(validation: TournamentDeckSnapshot['validation']): TournamentDeckSnapshot {
  return {
    deckId: 'deck-1',
    name: 'Turnierdeck',
    formatName: 'Advanced',
    formatId: 'advanced',
    sections: { main: [], extra: [], side: [] },
    counts: { main: 10, extra: 0, side: 0, total: 10 },
    validation,
    capturedAt: '2026-09-12T11:13:52.000Z',
  }
}

// Renders a popover's content inline, so the issue list is in the DOM
// without driving reka-ui's open state in jsdom.
const InlinePopover = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.default?.(), slots.content?.()])
  },
})

function mountWithOpenPopovers() {
  return mountSuspended(TournamentDetailPage, {
    global: { stubs: { UPopover: InlinePopover, Popover: InlinePopover } },
  })
}

describe('tournament detail page — deck snapshot issues', () => {
  it('renders issueDetails through the validation catalogue', async () => {
    state.tournament = tournamentDetail({
      participants: [participant({
        deckId: 'deck-1',
        deckName: 'Turnierdeck',
        deckLegal: false,
        deckIssueCount: 2,
        deckSnapshot: snapshot({
          legal: false,
          issueCount: 2,
          issues: ['Main Deck has 10 cards; at least 40 are required.', 'Pot of Greed is forbidden in this format.'],
          issueDetails: [
            { severity: 'error', code: 'deck_size_min', message: 'Main Deck has 10 cards; at least 40 are required.', params: { section: 'main', count: 10, min: 40 } },
            { severity: 'error', code: 'card_forbidden', message: 'Pot of Greed is forbidden in this format.', params: { cardId: 55144522, cardName: 'Pot of Greed' } },
          ],
        }),
      })],
    })

    const component = await mountWithOpenPopovers()

    const text = component.text()
    expect(text).toContain('Das Main Deck hat 10 Karten, mindestens 40 sind erforderlich.')
    expect(text).toContain('Pot of Greed ist in diesem Format verboten.')
    expect(text).not.toContain('is forbidden in this format')
  })

  it('still renders the stored strings of a snapshot taken before issueDetails existed', async () => {
    state.tournament = tournamentDetail({
      participants: [participant({
        deckId: 'deck-1',
        deckName: 'Turnierdeck',
        deckLegal: false,
        deckIssueCount: 1,
        deckSnapshot: snapshot({
          legal: false,
          issueCount: 1,
          issues: ['Topf der Gier ist in diesem Format verboten.'],
        }),
      })],
    })

    const component = await mountWithOpenPopovers()
    expect(component.text()).toContain('1 Regelverstoß')
    // Same text as the former hard-coded `Intl.DateTimeFormat('de-DE', …)`.
    const registeredAt = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date('2026-09-12T11:13:52.000Z'))
    expect(component.text()).toContain(`Angemeldet am ${registeredAt}`)
    expect(component.text()).toContain('Topf der Gier ist in diesem Format verboten.')
  })
})

describe('tournament detail page — English', () => {
  it('renders the header, participants, rounds and standings in English', async () => {
    await setTestLocale('en')
    state.tournament = tournamentDetail({
      status: 'running',
      pairingSystem: 'round_robin',
      plannedRounds: 3,
      format: { id: 'advanced', name: 'Advanced', isBuiltin: true },
      participants: [
        participant({
          deckId: 'deck-1',
          deckName: 'Turnierdeck',
          deckLegal: false,
          deckIssueCount: 2,
          deckSnapshot: snapshot({ legal: false, issueCount: 2, issues: [] }),
        }),
        participant({ id: 'p-2', name: 'Alice', isSelf: false, linked: false, dropped: true }),
      ],
      rounds: [round()],
      currentRound: round(),
      standings: [
        standing(),
        standing({ participantId: 'p-2', rank: 2, name: 'Alice', points: 0, wins: 0, losses: 1, dropped: true }),
      ],
      canEditPairings: true,
    })

    const component = await mountSuspended(TournamentDetailPage)
    const text = component.text()

    expect(text).toContain('Back to tournaments')
    expect(text).toContain('Running')
    expect(text).toContain('Pairing system: Round robin')
    expect(text).toContain('Round 1 of 3')
    expect(text).toContain('Organizer: Organizer')
    expect(text).toContain('Complete round')
    expect(text).toContain('Next round')
    expect(text).toContain('Finish tournament')
    expect(text).toContain('Delete tournament')
    expect(text).toContain('All results must be entered')

    expect(text).toContain('Participants (2)')
    expect(text).toContain('Not legal')
    expect(text).toContain('2 rule violations')
    expect(text).toContain('Registered on 09/12/2026')
    expect(text).toContain('Dropped')
    expect(text).toContain('“Account”: Player with their own user account')

    expect(text).toContain('Rounds')
    expect(text).toContain('Swap pairings')
    expect(text).toContain('Table 1')
    expect(text).toContain('Save result')
    expect(component.find('[aria-label="Games won by Organizer"]').exists()).toBe(true)

    expect(text).toContain('Standings')
    expect(text).toContain('66.7%')
    expect(text).toContain('Points: win 3, draw 1 · W-L-D = wins–losses–draws')
    expect(component.find('abbr[title="Wins–losses–draws"]').exists()).toBe(true)

    for (const german of ['Runde', 'Teilnehmer', 'Tabelle', 'Ausgestiegen', 'Regelverstöße', 'Paarungssystem']) {
      expect(text).not.toContain(german)
    }
  })

  it('shows why "Start tournament" is disabled in English', async () => {
    await setTestLocale('en')
    state.tournament = tournamentDetail({ participants: [participant()], canStart: false })

    const component = await mountSuspended(TournamentDetailPage)

    expect(component.findAll('p').some(p => p.text() === 'At least 2 participants needed')).toBe(true)
    expect(component.text()).toContain('No format')
    expect(component.text()).toContain('Not started yet')
  })
})
