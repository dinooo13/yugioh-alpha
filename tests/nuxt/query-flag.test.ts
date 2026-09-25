// One boolean query rule for the catalog, the inventory and the deck list (#148).
import { describe, expect, it } from 'vitest'
import { parseDeckListQuery } from '../../server/utils/decks'
import { parseQueryFlag, parseQueryTriState } from '../../server/utils/query-flag'

describe('parseQueryFlag', () => {
  it.each([
    ['1', '1'],
    ['true', 'true'],
    ['1 (number)', 1],
    ['true (boolean)', true],
    ['[\'1\']', ['1']],
    ['[\'1\', \'0\']', ['1', '0']],
  ])('%s is on', (_label, value) => {
    expect(parseQueryFlag(value)).toBe(true)
  })

  it.each([
    ['0', '0'],
    ['false', 'false'],
    ['yes', 'yes'],
    ['empty', ''],
    ['undefined', undefined],
    ['null', null],
    ['0 (number)', 0],
    ['false (boolean)', false],
    ['[\'0\', \'1\']', ['0', '1']],
    ['[]', []],
  ])('%s is off', (_label, value) => {
    expect(parseQueryFlag(value)).toBe(false)
  })
})

describe('parseQueryTriState', () => {
  it.each([
    ['1', '1', true],
    ['true', 'true', true],
    ['1 (number)', 1, true],
    ['true (boolean)', true, true],
    ['[\'1\', \'0\']', ['1', '0'], true],
    ['0', '0', false],
    ['false', 'false', false],
    ['0 (number)', 0, false],
    ['false (boolean)', false, false],
    ['[\'0\', \'1\']', ['0', '1'], false],
    ['missing', undefined, undefined],
    ['null', null, undefined],
    ['empty', '', undefined],
    ['yes', 'yes', undefined],
    ['TRUE', 'TRUE', undefined],
    ['[]', [], undefined],
  ])('%s → %s', (_label, value, expected) => {
    expect(parseQueryTriState(value)).toBe(expected)
  })
})

// The deck list's "legal in its format" filter keeps its three states.
describe('parseDeckListQuery legal', () => {
  it('reads on, off and "don\'t filter"', () => {
    expect(parseDeckListQuery({ legal: '1' }).legal).toBe(true)
    expect(parseDeckListQuery({ legal: 'true' }).legal).toBe(true)
    expect(parseDeckListQuery({ legal: true }).legal).toBe(true)
    expect(parseDeckListQuery({ legal: '0' }).legal).toBe(false)
    expect(parseDeckListQuery({ legal: 'false' }).legal).toBe(false)
    expect(parseDeckListQuery({ legal: false }).legal).toBe(false)
    expect(parseDeckListQuery({ legal: ['0', '1'] }).legal).toBe(false)
    expect(parseDeckListQuery({}).legal).toBeUndefined()
    expect(parseDeckListQuery({ legal: '' }).legal).toBeUndefined()
    expect(parseDeckListQuery({ legal: 'maybe' }).legal).toBeUndefined()
  })
})
