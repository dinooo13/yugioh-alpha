import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import EntryReviewTable from '~/components/entry/EntryReviewTable.vue'
import {
  buildBulkItems,
  createEntryRows,
  summarizeEntryRows,
} from '~/utils/card-entry'
import type { EntryCandidate, EntryRow, EntrySuggestResult } from '~/utils/card-entry'

mockNuxtImport('useFetch', () => {
  return () => ({ data: ref({ items: [] }), pending: ref(false), refresh: vi.fn() })
})

function candidate(overrides: Partial<EntryCandidate> & { name: string, cardId: number }): EntryCandidate {
  return {
    type: 'Normal Monster',
    frameType: 'normal',
    imageSmall: null,
    score: 1,
    matchedBy: 'exact',
    printings: [],
    ...overrides,
  }
}

function result(
  raw: string,
  candidates: EntryCandidate[],
  input: Partial<EntrySuggestResult['input']> = {},
): EntrySuggestResult {
  return {
    input: { raw, quantity: 1, query: raw, ...input },
    candidates,
  }
}

const exactResult = result('Dark Magician', [
  candidate({ cardId: 46986414, name: 'Dark Magician' }),
])

const setCodeResult = result('SDY-006', [
  candidate({
    cardId: 46986414,
    name: 'Dark Magician',
    matchedBy: 'set_code',
    printings: [
      { id: 'LOB-005', setCode: 'LOB-005', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare' },
      { id: 'SDY-006', setCode: 'SDY-006', setName: 'Starter Deck: Yugi', rarity: 'Ultra Rare' },
    ],
  }),
], { setCode: 'SDY-006', query: 'SDY-006' })

const fuzzyResult = result('Dark Magican', [
  candidate({ cardId: 46986414, name: 'Dark Magician', matchedBy: 'fuzzy', score: 0.88 }),
])

const uncertainResult = result('Magier', [
  candidate({ cardId: 46986414, name: 'Dark Magician', matchedBy: 'contains', score: 0.62 }),
  candidate({ cardId: 38033121, name: 'Dark Magician Girl', matchedBy: 'contains', score: 0.51 }),
])

const noMatchResult = result('Völlig unbekannt', [])

async function mountTable(rows: EntryRow[]) {
  return mountSuspended(EntryReviewTable, {
    props: {
      rows,
      collections: [{ id: 'col-1', name: 'Box 1' }],
    },
  })
}

describe('entry row preselection', () => {
  it('preselects certain and high-scoring matches only', () => {
    const [exact, fuzzy, uncertain, noMatch] = createEntryRows([
      exactResult,
      fuzzyResult,
      uncertainResult,
      noMatchResult,
    ])

    expect(exact!.selectedCardId).toBe(46986414)
    expect(fuzzy!.selectedCardId).toBe(46986414)
    expect(uncertain!.selectedCardId).toBeNull()
    expect(noMatch!.selectedCardId).toBeNull()
  })

  it('preselects the printing that matches a parsed set code', () => {
    const [row] = createEntryRows([setCodeResult])

    expect(row).toMatchObject({ selectedCardId: 46986414, setCode: 'SDY-006', printingId: 'SDY-006' })
  })

  it('carries the parsed quantity into the row', () => {
    const [row] = createEntryRows([result('3x Dark Magician', exactResult.candidates, { quantity: 3 })])

    expect(row!.quantity).toBe(3)
  })

  it('counts rows by status', () => {
    const rows = createEntryRows([exactResult, fuzzyResult, uncertainResult, noMatchResult])

    expect(summarizeEntryRows(rows)).toEqual({ total: 4, sicher: 2, unsicher: 1, ohneTreffer: 1 })
  })
})

describe('EntryReviewTable', () => {
  it('renders a summary and a status per row', async () => {
    const component = await mountTable(createEntryRows([exactResult, uncertainResult, noMatchResult]))
    const text = component.text()

    expect(text).toContain('3 gesamt')
    expect(text).toContain('1 sicher')
    expect(text).toContain('1 unsicher')
    expect(text).toContain('1 ohne Treffer')
    expect(text).toContain('Dark Magician')
    expect(text).toContain('Kein Treffer')
    expect(text).toContain('Standardwerte')
  })

  it('blocks "Alle speichern" while a row is unresolved', async () => {
    const component = await mountTable(createEntryRows([exactResult, uncertainResult]))

    const saveAll = component.findAll('button').find(button => button.text().includes('Alle speichern'))
    expect(saveAll).toBeTruthy()
    expect(saveAll!.attributes('disabled')).toBeDefined()

    // The escape hatch for partially resolved batches is offered instead.
    const saveResolved = component.findAll('button').find(button => button.text().includes('Nur aufgelöste speichern'))
    expect(saveResolved).toBeTruthy()
    expect(saveResolved!.attributes('disabled')).toBeUndefined()
    expect(component.text()).toContain('Es gibt noch offene Zeilen')
  })

  it('enables "Alle speichern" once every row is resolved', async () => {
    const component = await mountTable(createEntryRows([exactResult, setCodeResult]))

    const saveAll = component.findAll('button').find(button => button.text().includes('Alle speichern'))
    expect(saveAll!.attributes('disabled')).toBeUndefined()
    expect(component.findAll('button').some(button => button.text().includes('Nur aufgelöste speichern'))).toBe(false)
  })

  it('propagates the Standardwerte to every row without an override', async () => {
    const rows = createEntryRows([exactResult, setCodeResult])
    rows[1]!.language = 'fr'

    const component = await mountTable(rows)
    expect(component.text()).toContain('EN · Near Mint · Unlimited')
    expect(component.text()).toContain('FR · Near Mint · Unlimited')

    const vm = component.vm as unknown as { defaults: { language: string, condition: string } }
    vm.defaults.language = 'de'
    vm.defaults.condition = 'played'
    await nextTick()

    expect(component.text()).toContain('DE · Played · Unlimited')
    // The per-row override survives a defaults change.
    expect(component.text()).toContain('FR · Played · Unlimited')
  })

  it('emits nothing and keeps rows untouched until the user saves', async () => {
    const component = await mountTable(createEntryRows([exactResult]))

    expect(component.emitted('saved')).toBeUndefined()
    expect(component.emitted('update:rows')).toBeUndefined()
  })

  it('removes a row through its remove button', async () => {
    const component = await mountTable(createEntryRows([exactResult, noMatchResult]))

    const remove = component.findAll('button').find(button => button.attributes('aria-label')?.includes('entfernen'))
    expect(remove).toBeTruthy()
    await remove!.trigger('click')

    const updates = component.emitted('update:rows') as Array<[EntryRow[]]> | undefined
    expect(updates?.at(-1)?.[0]).toHaveLength(1)
  })
})

describe('bulk payload', () => {
  it('only includes resolved rows and applies defaults plus per-row overrides', () => {
    const rows = createEntryRows([exactResult, setCodeResult, noMatchResult])
    rows[0]!.quantity = 2
    rows[1]!.language = 'de'
    rows[1]!.collectionId = 'col-1'

    const items = buildBulkItems(rows, {
      language: 'en',
      condition: 'near_mint',
      edition: 'first',
      collectionId: '__no_collection__',
    })

    expect(items).toEqual([
      {
        catalogCardId: 46986414,
        printingId: null,
        collectionId: null,
        quantity: 2,
        language: 'en',
        condition: 'near_mint',
        edition: 'first',
      },
      {
        catalogCardId: 46986414,
        printingId: 'SDY-006',
        collectionId: 'col-1',
        quantity: 1,
        language: 'de',
        condition: 'near_mint',
        edition: 'first',
      },
    ])
  })
})
