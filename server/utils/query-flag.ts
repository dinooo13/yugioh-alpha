// Boolean query parameters, one rule for every list API (#148).

function firstValue(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * A query filter that can be on, off or absent (`?legal=1` / `?legal=0` /
 * no param): `'1'` / `'true'` (and 1 / true from non-HTTP callers) are
 * `true`, `'0'` / `'false'` (and 0 / false) are `false`, anything else
 * (missing, '', 'yes') is `undefined`, i.e. "don't filter". The first value
 * counts for repeated params.
 */
export function parseQueryTriState(raw: unknown): boolean | undefined {
  const value = firstValue(raw)
  if (value === '1' || value === 'true' || value === 1 || value === true) {
    return true
  }
  if (value === '0' || value === 'false' || value === 0 || value === false) {
    return false
  }
  return undefined
}

/**
 * A boolean query flag (`?inText=1`): `'1'` / `'true'` (and 1 / true from
 * non-HTTP callers) are on, everything else (missing, '0', 'false', '') is off.
 * The first value counts for repeated params. Shared by the catalog and the
 * inventory parsers (#148) so both accept the same values.
 */
export function parseQueryFlag(raw: unknown): boolean {
  return parseQueryTriState(raw) === true
}
