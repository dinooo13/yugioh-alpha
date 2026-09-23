// Draft texts the chat composer is pre-filled with when the assistant is
// opened from a deck entry point (docs/adr/0011-deck-assistance-in-chat.md):
// `/assistant?intent=new-deck` ("Mit KI erstellen" on /decks) and
// `/assistant?deckId=…`, which continues as `?intent=edit-deck` ("Mit KI
// bearbeiten" in the deck editor). Only a draft — never sent automatically.

export const ASSISTANT_INTENT_DRAFTS = {
  'new-deck': 'Baue mir aus meinen Karten ein neues Deck. Format und Spielstil: ',
  'edit-deck': 'Wie kann ich dieses Deck mit Karten aus meinem Inventar verbessern?',
} as const

export type AssistantIntent = keyof typeof ASSISTANT_INTENT_DRAFTS

export function isAssistantIntent(value: unknown): value is AssistantIntent {
  return typeof value === 'string' && Object.hasOwn(ASSISTANT_INTENT_DRAFTS, value)
}

/** The composer draft for an `?intent=` query value, or '' for anything else. */
export function assistantIntentDraft(value: unknown): string {
  return isAssistantIntent(value) ? ASSISTANT_INTENT_DRAFTS[value] : ''
}
