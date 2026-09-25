# 0021: No deck link in assistant conversations

## Status

Accepted (#130). Supersedes the "Deck-linked conversations", "Per-turn
context injection, never persisted" and "Entry points" sections of
[0011](0011-deck-assistance-in-chat.md), and the `/decks/assistent` target in
the mapping table of [0013](0013-english-url-scheme.md).

Note: `deck_id` and `idx_assistant_conversation_deck` were dropped by
migration 0017 (#137) with `ALTER TABLE … DROP COLUMN` after dropping the
index. No table rebuild was needed, because the deck FK is a column
constraint of `deck_id`.

## Context

[ADR 0011](0011-deck-assistance-in-chat.md) linked a conversation to one of
the user's decks: the deck editor's "Mit KI bearbeiten" and `/decks`' "Mit KI
erstellen" opened the chat, a linked conversation was titled
`Deck: <name>` and showed a deck chip, and the linked deck's current state
was added to the system prompt on every turn.

The owner tested the assistant, and #85 asked for more: several linked decks
and formats per conversation. But the assistant already reads every deck and
format through its tools (`list_decks`, `get_deck`, `validate_deck`,
`list_formats`), so the link mostly shows something the model can look up
anyway. Owner decision: #85 is declined, and the existing single-deck link
goes too, with nothing kept "for later".

## Decision

- Conversations aren't linked to decks. There is no deck chip, no per-turn
  deck context block, no `Deck: <name>` title, no reuse of an empty
  deck-linked conversation, and no `deck` field in the conversation summary
  (`AssistantConversationSummary` is `{ id, title, createdAt, updatedAt }`).
- `POST /api/assistant/chat` ignores any request body. Old clients that
  still send `{ deckId }` get a plain conversation (201).
- No entry points from `/decks` or the deck editor into the assistant. The
  user opens the assistant from the navigation and names the deck.
- `/decks/assistent` redirects to plain `/assistant` (the query is passed
  through; no `intent` is added).
- `/assistant` no longer reads `?deckId=` or `?intent=`. Such URLs (old
  bookmarks, PWA history) land on the newest conversation or the empty
  state, like plain `/assistant`.
- The composer has no prefill (`initialText` and the intent drafts are
  gone). `LayoutPageHeader`'s `hideTitle` (#48, only used next to the deck
  chip) is gone as well.
- `assistant_conversation.deck_id` stays, deprecated and unused, with its
  index and `ON DELETE SET NULL`. Dropping a column needs a table rebuild,
  which the migrator can't do safely (same reason as in ADR 0011). There is
  no data migration: old rows keep their value, and nothing reads or writes
  it.
- Old deck-linked conversations become normal conversations and keep their
  stored titles. The model-generated titles (#129) treat a stored
  `Deck: <name>` as a user title, not an automatic one, so they leave it
  alone. An old deck-linked conversation that is still **empty** is named
  after its first message like any other.

## Consequences

- The user names the deck, and the model finds it with `list_decks` /
  `get_deck`: one or two more tool round trips per deck conversation.
- There is no "this deck" shortcut any more.
- Less code, and one fewer path in the system prompt.
- `deck_id` is a dead column until the table is rebuilt for another reason.
- Old deck-linked conversations lose their deck chip.

## Supersedes

- From [ADR 0011](0011-deck-assistance-in-chat.md): "Deck-linked
  conversations", "Per-turn context injection, never persisted" and "Entry
  points". The removal of the one-shot path, the ported guarantees, the
  dropped features and the "Assistent nicht verfügbar" notice still apply.
- From [ADR 0013](0013-english-url-scheme.md): the `/decks/assistent` target
  (`/assistant?intent=new-deck`), now plain `/assistant`.
- From [ADR 0020](0020-assistant-on-the-ai-sdk.md): the per-turn deck context
  listed under "Kept as they were".
