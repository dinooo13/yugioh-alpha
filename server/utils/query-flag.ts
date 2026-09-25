/**
 * A boolean query flag (`?inText=1`): `'1'` / `'true'` (and 1 / true from
 * non-HTTP callers) are on, everything else (missing, '0', 'false', '') is off.
 * The first value counts for repeated params. Shared by the catalog and the
 * inventory parsers (#148) so both accept the same values.
 */
export function parseQueryFlag(raw: unknown): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '1' || value === 'true' || value === 1 || value === true
}
