/**
 * German has exactly two card-count plural forms in this app ("1 Karte" vs.
 * "2 Karten") but the singular/plural logic used to be re-implemented ad hoc
 * at each call site, and a few of them forgot it entirely — producing bugs
 * like "1 Karten" (UX review #10). Centralizing it here makes that a
 * one-line fix everywhere it's used.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}
