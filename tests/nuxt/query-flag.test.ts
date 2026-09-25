// One boolean query flag rule for the catalog and the inventory (#148).
import { describe, expect, it } from 'vitest'
import { parseQueryFlag } from '../../server/utils/query-flag'

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
