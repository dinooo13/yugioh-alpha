# 0011: Deck assistance in the chat assistant

## Status

Accepted. Mechanism note: the per-turn deck context is now passed as `instructions` by the [ADR 0020](0020-assistant-on-the-ai-sdk.md) engine; the decisions are unchanged.

## Context

Since [ADR 0010](0010-chat-assistant-with-tools.md) the app had two parallel
ways to get AI help with a deck:

- the one-shot **AI deck assistant** ([ADR 0006](0006-ai-deck-assistant.md),
  provider per [ADR 0009](0009-openai-compatible-assistant-provider.md)):
  `/decks/assistent` ("Mit KI erstellen") and the deck editor's
  "KI-Vorschläge" slideover, both backed by `POST /api/assistant/suggest` — a
  single structured-output call (`generate()`, `json_schema` with
  `json_object`/no-format fallbacks) over a precomputed candidate pool,
  re-validated server-side and shown as owned changes plus a separate
  missing-cards list;
- the **chat assistant** at `/assistent`, which could already search the
  inventory, read and validate decks, and propose `create_deck` /
  `update_deck_cards` actions — but knew nothing about "this deck" unless
  the user named it, and showed a deck proposal only as a raw id/quantity
  table.

Two code paths, two prompts, two trust boundaries, and two UIs for the same
job, where the chat was strictly more capable (it can ask back, look cards
up, and iterate). Issue #24 decided to remove the one-shot path and fold deck
assistance into the chat — after porting whatever the old path guaranteed
that the chat tools didn't.

## Decision

### Remove the one-shot path

Deleted: `/decks/assistent`, the deck editor's "KI-Vorschläge" slideover and
its components (`AssistantRequestForm`, `AssistantValidationSummary`),
`POST /api/assistant/suggest`, `server/utils/deck-assistant.ts`,
`shared/deck-assistant.ts`, and the model abstraction's `generate()` with
everything only it used (`AssistantModelInput`, the pool/current-deck input
types, the non-streaming `postChatCompletion`, response-body parsing, code
fence stripping, the `json_schema` → `json_object` → none fallback, and the
fake model's build/improve outputs). `GET /api/assistant/status` stays; its
type moved to `shared/assistant-chat.ts` as `AssistantStatus`.

### Deck-linked conversations

`assistant_conversation` gains a nullable `deck_id` column —
`REFERENCES deck(id) ON DELETE SET NULL`, indexed
(`idx_assistant_conversation_deck`) — plus a `deck` relation. Migration
`0009` is a plain `ALTER TABLE … ADD` + `CREATE INDEX` (drizzle-kit's
generated `ALTER` omitted the `ON DELETE` clause, so it was completed by
hand; a table rebuild was deliberately avoided, because the migrator runs in
a transaction where `PRAGMA foreign_keys=OFF` has no effect, and dropping the
old table would cascade-delete every message and action).

- `POST /api/assistant/chat` accepts an optional body `{ deckId }` (an empty
  body creates a plain conversation, as before). The deck must be the
  caller's own (`requireOwnDeck`, 404 otherwise — same ownership boundary as
  everywhere else).
- A linked conversation is titled `Deck: <name>`, and the first message
  doesn't overwrite that title.
- If the caller already has an **empty** (no messages) conversation linked to
  that deck, it is returned instead of creating another — clicking "Mit KI
  bearbeiten" twice doesn't pile up empty threads. Once it has messages, the
  next click starts a fresh one.
- `SET NULL` rather than `CASCADE`: deleting a deck unlinks its
  conversations, it never deletes chat history (or the actions recorded in
  it).
- The conversation summary carries `deck: { id, name } | null`; the thread
  header shows it as a chip linking back to `/decks/<id>`.

### Per-turn context injection, never persisted

For a linked conversation, `runChatTurn` rebuilds a context block from
`getDeckDetail` at the start of every turn and appends it to the system
prompt: deck id and name, format, Main/Extra/Side counts, the rule engine's
legality (with issue messages), and one line per card
(`catalogCardId|name|section|quantity|owned`, capped at 200 lines), ending
with "change this deck only via `update_deck_cards` with this `deckId`;
`quantity` is the new absolute amount". It is omitted when the deck is gone.

It is not stored as a message: a persisted snapshot would go stale the moment
the user applies a proposal or edits the deck by hand, and the history would
then carry contradicting deck states. Rebuilt per turn, "dieses Deck" always
means the deck as it is *now*, and an applied change is visible on the very
next turn. The cost (a few thousand characters per turn) is small next to the
history budget. The deck name and card names are user data inside the system
prompt, so the block says they are data, not instructions; the free-text deck
description is left out entirely.

### Ported guarantees

What the old path guaranteed, now in the chat tools:

- **Format limits on inventory cards.** `search_inventory` takes an optional
  `formatId` and returns, per owned card, `maxCopies` — the rule engine's
  effective per-card limit (`maxCopiesByCard` in
  `server/utils/deck-validation.ts`, the old pool's `computeMaxCopiesByCard`,
  3 without a format) — and leaves format-forbidden cards out. It also
  returns the card facts the old pool carried (type, attribute, race, level,
  ATK/DEF, archetype, `isExtra`; card text stays with `get_card`) and pages
  with `offset` instead of truncating at a fixed pool size.
- **Inventory first.** The system prompt gains a short "Deckbau" block:
  prefer the user's inventory, standard deck sizes and Extra-Deck-only
  sections, copy limits, validate before proposing, `quantity` is absolute,
  give short reasons.
- **Proposals are checked and previewed before "Übernehmen".**
  `previewDeckProposal` (`server/utils/deck-proposal.ts`) computes, for a
  planned deck or a deck plus changes: counts, legality from `evaluateDeck`
  (never the model's claim), and `missing` — per card, needed vs. owned.
  `validate_deck` exposes it to the model (`deckId` is now optional; `cards`
  checks a planned new deck, `deckId` + `changes` a changed one; `deckId`
  alone behaves as before). `create_deck` / `update_deck_cards` return it in
  their tool result and store it in the action's `payload.preview`, next to
  per-row card names and the deck/format names. The action card shows a
  legality badge, counts, up to five issues and a separate "Fehlende Karten"
  list, labelled "Stand beim Vorschlag" — `applyAction` still re-validates
  everything at apply time and reads only the keys it needs, so the
  display-only extras can't influence a write.
- **Section fix-up / unknown ids** stay the chat's existing strict
  validation (a bad id or section is a tool error the model retries), and
  **name resolution** is `search_catalog`.
- **New deck in one step** stays the `create_deck` action (deck and format
  in one transaction); an applied one now offers "Deck öffnen".

### Dropped, and why

- Per-change apply, "Alle übernehmen", "Trotzdem hinzufügen": a chat
  proposal is all-or-nothing (`update_deck_cards` in one transaction); the
  user can ask for a smaller proposal instead.
- Play-style presets and the 500-character notes field: the chat message is
  the preference.
- `includeMissing`, the 400-card pool cap and its truncation warnings: the
  model searches and pages the inventory itself; missing cards are allowed
  but always listed separately in the preview.
- Structured JSON output (`generate()`, the `json_schema`/`json_object`
  fallback chain, 502 on unparsable JSON) and the fake model's build/improve
  output: no remaining caller.
- The per-user in-flight guard of `suggest`: covered by the chat's per-user
  turn lock (ADR 0010).

### Entry points

Plain links, so the side effect (creating a conversation) only ever happens
client-side on purpose:

- Deck editor: "Mit KI bearbeiten" → `/assistent?deckId=<id>`, shown only
  when the chat is enabled, in place of "KI-Vorschläge".
- `/decks`: "Mit KI erstellen" → `/assistent?intent=new-deck`.
- `/assistent` with `deckId` or `intent` skips the redirect to the newest
  conversation, shows "Unterhaltung wird vorbereitet …", creates the
  conversation on mount, and replaces the URL with
  `/assistent/<id>?intent=edit-deck|new-deck`. The conversation page fills
  (never sends) a German draft into the composer and drops the query.
- `routeRules['/decks/assistent']` redirects old bookmarks to
  `/assistent?intent=new-deck` (without it the URL would match
  `/decks/[id]`).

### "Assistent nicht verfügbar"

A shared `AssistantUnavailableNotice` replaces the old per-page notice that
listed server env var names. Users can't act on those; the notice says the
assistant isn't set up on this server and to contact whoever runs the app.
`useAssistantStatus()` replaces three copies of the status fetch.

## Consequences

- One deck-assistance code path, one prompt, one trust boundary: the chat
  tools. Everything the old path guaranteed about format limits, legality,
  and owned vs. missing cards is still enforced or shown before a write.
- The model can now propose cards the user doesn't own at all — intended
  (the old path allowed them too, as "missing") and visible in the preview's
  missing list before the user confirms.
- A pending action's preview is a snapshot and can go stale (inventory or
  format changed since); it's labelled as such, and applying re-validates.
- Deck building now costs several model round trips (search, validate,
  propose) instead of one call — more latency and tokens per deck, in
  exchange for a conversation the user can steer.
- A client-side navigation to `/decks/assistent` could bypass the server
  redirect; no in-app link points there anymore.

## Supersedes

- [ADR 0006](0006-ai-deck-assistant.md) in full (status: "Superseded by ADR
  0011"; its model-provider section had already been superseded by ADR 0009).
- The structured-output `generate()` parts of
  [ADR 0009](0009-openai-compatible-assistant-provider.md); its provider
  configuration and error mapping still apply to `chat()`.
- [ADR 0010](0010-chat-assistant-with-tools.md)'s statement that
  `/decks/assistent` and the deck editor's "KI-Vorschläge" stay unchanged.
