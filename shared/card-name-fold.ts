/**
 * Folds a card name into its search form (ADR 0015): the value stored in
 * `catalog_card.name_search` / `catalog_card_translation.name_search`, and
 * the value a search query is compared against. Pure, used on both sides.
 *
 * SQLite's `LIKE` only ignores case for ASCII, so "BLAUÄUGIGER" would never
 * match "Blauäugiger". Folding sidesteps that:
 *
 * 1. letters without a canonical decomposition are spelled out
 *    (`ß`/`ẞ` → `ss`, `æ` → `ae`, `œ` → `oe`, `ø` → `o`, `ł` → `l`, `đ` → `d`);
 * 2. NFKD splits accented letters (and full-width forms) into base + mark;
 * 3. the combining marks are dropped (`ä` → `a`, `é` → `e`);
 * 4. lowercase;
 * 5. everything that isn't a letter or digit goes, spaces and punctuation too
 *    ("Blue-Eyes" and "blue eyes" both become "blueeyes").
 *
 * The result never contains `%` or `_`, so it can go into a `LIKE` pattern
 * without escaping. An empty result means "nothing to search the folded
 * columns for".
 */
export function foldCardName(value: string): string {
  return value
    .replace(/[ßẞ]/g, 'ss')
    .replace(/æ/giu, 'ae')
    .replace(/œ/giu, 'oe')
    .replace(/ø/giu, 'o')
    .replace(/ł/giu, 'l')
    .replace(/đ/giu, 'd')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}
