// The text of the chat's tool chips (app/utils/assistant-tool-activity.ts):
// what `toolPartCall` reads from a tool part and how `toolCallLabel` names
// it — `get_card` with the card's name from its result instead of the id
// (#128), in the card language.

import { describe, expect, it } from 'vitest'
import type { Composer } from 'vue-i18n'
import { pickCardName } from '~~/shared/card-text'
import type { CardNameFields } from '~~/shared/card-text'
import { toolCallLabel, toolPartCall } from '~/utils/assistant-tool-activity'
import type { AssistantToolPartLike } from '~/utils/assistant-tool-activity'

type Translate = Parameters<typeof toolCallLabel>[0]

function translate(): Translate {
  const i18n = useNuxtApp().$i18n as Composer
  return ((key: string, named?: Record<string, unknown>) => i18n.t(key, named ?? {})) as Translate
}

const inGerman = (card: CardNameFields) => pickCardName(card, 'de')
const inEnglish = (card: CardNameFields) => pickCardName(card, 'en')

function getCard(state: string, output?: unknown, errorText?: string): AssistantToolPartLike {
  return { type: 'tool-get_card', state, input: { id: 46986414 }, ...(output !== undefined ? { output } : {}), ...(errorText ? { errorText } : {}) }
}

const DARK_MAGICIAN = { result: { id: 46986414, name: 'Dark Magician', nameDe: 'Dunkler Magier', type: 'Normal Monster' } }

describe('toolPartCall / toolCallLabel: get_card (#128)', () => {
  it('names the card by its id while the call runs', () => {
    const call = toolPartCall(getCard('input-available'), inGerman)
    expect(call.cardName).toBeUndefined()
    expect(toolCallLabel(translate(), call)).toBe('Liest Kartendetails: 46986414')
  })

  it('names the card once the result is there, in the card language', () => {
    expect(toolCallLabel(translate(), toolPartCall(getCard('output-available', DARK_MAGICIAN), inGerman))).toBe('Liest Kartendetails: Dunkler Magier')
    expect(toolCallLabel(translate(), toolPartCall(getCard('output-available', DARK_MAGICIAN), inEnglish))).toBe('Liest Kartendetails: Dark Magician')
  })

  it('falls back to the English name when the result has no German one (a turn in English card language)', () => {
    const output = { result: { id: 46986414, name: 'Dark Magician' } }
    expect(toolPartCall(getCard('output-available', output), inGerman).cardName).toBe('Dark Magician')
  })

  it('picks the English name without a picker', () => {
    expect(toolPartCall(getCard('output-available', DARK_MAGICIAN)).cardName).toBe('Dark Magician')
  })

  it.each([
    ['a failed call', getCard('output-error', undefined, 'Card not found.')],
    ['a result that is an error', getCard('output-available', { result: { error: 'Result too large' } })],
    ['a result without a name', getCard('output-available', { result: { id: 46986414 } })],
  ])('keeps the id for %s', (_label, part) => {
    const call = toolPartCall(part, inGerman)
    expect(call.cardName).toBeUndefined()
    expect(toolCallLabel(translate(), call)).toBe('Liest Kartendetails: 46986414')
  })
})

describe('toolPartCall / toolCallLabel: other tools stay as they were', () => {
  it('names a search by its query', () => {
    const part: AssistantToolPartLike = { type: 'tool-search_catalog', state: 'output-available', input: { query: 'Dark Magician' }, output: { result: [{ id: 1, name: 'Dark Magician', nameDe: 'Dunkler Magier' }] } }
    const call = toolPartCall(part, inGerman)
    expect(call.cardName).toBeUndefined()
    expect(toolCallLabel(translate(), call)).toBe('Sucht im Katalog: Dark Magician')
  })

  it('names a deck by its current name (#53)', () => {
    const part: AssistantToolPartLike = { type: 'tool-get_deck', state: 'output-available', input: { id: 'deck-1' }, output: { result: { id: 'deck-1', name: 'Alt' }, deckName: 'Magier' } }
    expect(toolCallLabel(translate(), toolPartCall(part, inGerman))).toBe('Liest ein Deck: Magier')
  })

  it('names an inventory proposal without details', () => {
    const part: AssistantToolPartLike = { type: 'tool-add_to_inventory', state: 'output-available', input: { items: [{ catalogCardId: 46986414, quantity: 2 }] }, output: { result: { status: 'pending_confirmation' } } }
    expect(toolCallLabel(translate(), toolPartCall(part, inGerman))).toBe('Schlägt vor, Karten ins Inventar aufzunehmen')
  })
})
