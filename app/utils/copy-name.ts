/**
 * The name of a copy ("Blue-Eyes (Kopie)") built with `render` — a message
 * like `decks.copyName` — shortened to fit `maxLength`: the original name is
 * truncated, never the added part. The UI names copies in the interface
 * language (ADR 0014); the server only falls back to its own suffix for API
 * callers that send no name.
 */
export function copyName(render: (name: string) => string, name: string, maxLength: number): string {
  const full = render(name)
  if (full.length <= maxLength) {
    return full
  }
  const overhead = render('').length
  return render(name.slice(0, Math.max(0, maxLength - overhead)).trimEnd())
}
