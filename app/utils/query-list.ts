import type { LocationQueryValue } from 'vue-router'

// URL helpers for multi-select filters, shared by the catalog and the
// inventory (#63, #148).

/** `?type=A,B` or repeated keys; old single-value links (`?attribute=DARK`) still work. */
export function queryList(value: LocationQueryValue | LocationQueryValue[] | undefined): string[] {
  return (Array.isArray(value) ? value : [value])
    .flatMap(item => (item ?? '').split(','))
    .map(item => item.trim())
    .filter(Boolean)
}

/** Multi-select facets go to the API and the URL as comma lists (#63); an empty selection is left out. */
export function csvQueryValue(values: Array<string | number>): string | undefined {
  return values.length ? values.join(',') : undefined
}
