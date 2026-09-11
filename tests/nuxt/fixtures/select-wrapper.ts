// Nuxt UI's `USelect` teleports its listbox out of the component tree, so
// component tests drive its `v-model` directly instead of clicking through the
// popup. `findAllComponents` loses the component's prop types on the way, so
// the wrapper is narrowed to the two members the tests need.

export interface SelectWrapper {
  props: (key: string) => unknown
  setValue: (value: unknown) => Promise<void>
}

export interface SelectItem {
  label: string
  value: string
}

/** The select whose `items` contain an option with `value`. */
export function selectWithOption(selects: unknown[], value: string): SelectWrapper | undefined {
  return (selects as SelectWrapper[]).find(select =>
    (select.props('items') as SelectItem[] | undefined)?.some(item => item.value === value))
}

export function optionLabels(select: SelectWrapper): string[] {
  return ((select.props('items') as SelectItem[] | undefined) ?? []).map(item => item.label)
}
