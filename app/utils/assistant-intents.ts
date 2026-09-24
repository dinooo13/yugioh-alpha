// Draft texts the chat composer is pre-filled with when the assistant is
// opened from a deck entry point (docs/adr/0011-deck-assistance-in-chat.md):
// `/assistant?intent=new-deck` ("Mit KI erstellen" on /decks) and
// `/assistant?deckId=…`, which continues as `?intent=edit-deck` ("Mit KI
// bearbeiten" in the deck editor). Only a draft — never sent automatically.
// The draft is the user's own message, so it is in the interface language
// (`assistant.intent.<intent>`, ADR 0014).

export const ASSISTANT_INTENTS = ['new-deck', 'edit-deck'] as const

export type AssistantIntent = typeof ASSISTANT_INTENTS[number]

export function isAssistantIntent(value: unknown): value is AssistantIntent {
  return typeof value === 'string' && (ASSISTANT_INTENTS as readonly string[]).includes(value)
}

/** The message key of the composer draft for an `?intent=` query value, or null for anything else. */
export function assistantIntentDraftKey(value: unknown): `assistant.intent.${AssistantIntent}` | null {
  return isAssistantIntent(value) ? `assistant.intent.${value}` : null
}
