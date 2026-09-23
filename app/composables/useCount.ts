/**
 * Count phrases ("1 Karte" / "2 Karten") in the active interface language.
 * The message holds both forms, e.g. `"{count} Karte | {count} Karten"`;
 * the number picks the form and is formatted with the locale's `integer`
 * number format (the explicit `count` parameter wins over vue-i18n's raw
 * plural count). Replaces `pluralize` from `shared/plural` in the UI.
 */
export function useCount() {
  const { t, n } = useI18n()
  return (key: string, count: number) => t(key, { count: n(count, 'integer') }, count)
}
