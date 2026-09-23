# 0012: Deck cover card chosen by the user

## Status

Accepted

## Context

Since PR #44 (#29) every deck tile (`/decks`, public profiles) shows a cover
card picked by rule (`pickDeckCover`, documented on `DeckCover` in
`shared/deck-cover.ts`): the first-added Main Deck monster, else the
first-added Main Deck card, else the first-added Extra Deck card; the Side
Deck is never used. "First added" is `deck_card.created_at`, which has second
precision — so decks whose cards arrive in one call (a chat assistant
`create_deck`, a `POST /api/decks` with `cards`, a duplicate) tie on every
row and fall back to the lowest catalog card id. That is stable, but
arbitrary: the tile often shows a card that doesn't represent the deck.

Issue #49 asks for the user to choose the cover card themselves.

## Decision

### A nullable `deck.cover_card_id`

`deck` gains `cover_card_id integer REFERENCES catalog_card(id) ON DELETE SET
NULL`; `NULL` means "picked by rule", which is every existing deck.

- `SET NULL`, not `CASCADE`: losing a cover card must never delete a deck. In
  practice it never fires — the catalog sync never deletes cards — it is a
  safety net.
- No index: nothing queries decks by cover card, catalog cards are never
  deleted, and the deck table is small.
- No drizzle relation: the column is only read next to the deck row.

Migration `0010` is a plain `ALTER TABLE deck ADD cover_card_id …`. As for
`0009` ([ADR 0011](0011-deck-assistance-in-chat.md)), drizzle-kit's generated
`ALTER` omitted the `ON DELETE` clause (the snapshot has it), so it was
completed by hand. A table rebuild was avoided for the reason given there:
the migrator runs in a transaction where `PRAGMA foreign_keys=OFF` has no
effect, so dropping and recreating `deck` would cascade-delete every
`deck_card` row and unlink every deck-linked conversation.

### The choice only counts while the card is in Main/Extra

The effective cover is the chosen card **while it has a Main or Extra Deck
row in the deck**; otherwise the #29 rule applies. `pickDeckCover(rows,
chosenCardId)` implements both, and `loadDeckCovers` reads the choice with
the candidates in its single query (join on `deck`), so every consumer —
`GET /api/decks`, the profile and shared deck tiles
(`server/utils/shared-views.ts`) and the deck detail — honors it without
further changes.

When the chosen card is removed or moved to the Side Deck, the column is
**not** cleared: reads fall back to the rule, and re-adding the card (or
moving it back) makes it the cover again. The alternative — clearing the
choice in every write path (the editor's quantity/remove/move endpoints, the
assistant's `update_deck_cards` apply, future bulk edits) — would spread
hooks across the code for little gain; one read-time rule covers them all.

### API

- `PATCH /api/decks/:id` accepts `coverCardId` (or `cover_card_id`), a
  positive integer or `null` (back to the rule), combinable with `name`,
  `description` and `formatId`. A number must be a Main or Extra Deck card
  of that deck, otherwise 400 (`cover_card_id must be a Main or Extra Deck
  card of this deck`); a malformed value is a 400 as well; another user's
  deck is a 404 as everywhere. All checks run before any write.
- A cover change is a real edit: it moves `updated_at` like a rename does.
- `DeckDetail` (every endpoint that returns it: `GET`/`PATCH
  /api/decks/:id`, `POST /api/decks`, duplicate, card writes) gains
  `cover: DeckCover | null` — the effective cover — and `coverIsChosen:
  boolean`, true only when `cover` is the explicit choice.
- Duplicating a deck copies the choice (the card rows are copied too, with
  their original `created_at`, so a rule-picked cover also matches).
- Deck list items keep their shape; their `cover` now honors the choice.

### Editor UI

The per-row move menu in the deck editor becomes a general row menu,
"Optionen für …" (e.g. "Optionen für Dark Magician") (`i-lucide-ellipsis-vertical`): the section
moves, plus — for Main/Extra rows — "Als Titelkarte festlegen", or
"Titelkarte automatisch wählen" on the row that is the chosen cover. A
rule-picked cover row still offers "festlegen", to pin it. The cover row
shows a badge, "Titelkarte" or "Titelkarte (automatisch)"; Side Deck rows of
the same card never do. (The label isn't "Weitere Aktionen für …" because
the header's "Weitere Aktionen" menu is located by that substring.)

### Not chosen

- **Side Deck covers.** The rule never uses the Side Deck; a choice doesn't
  either — the Side Deck isn't what the deck plays.
- **Any catalog card outside the deck.** The cover represents the deck's
  content; allowing arbitrary cards would need a catalog picker for a
  cosmetic feature.
- **Picking an artwork/printing.** The cover still uses the card's first
  image (`min(image_url)`), as in #29.
- **A separate `/cover` endpoint.** The cover is a deck attribute like the
  name or format; `PATCH /api/decks/:id` already validates and returns the
  detail.

## Consequences

- A stale choice (card removed or moved to Side) stays in the column
  invisibly until the card comes back; the UI then shows the rule's pick as
  "Titelkarte (automatisch)".
- `getDeckDetail` (and every write that returns a detail) costs one extra,
  small query for the cover.
- A `DeckDetail` stored as a chat assistant action's result grows by the
  cover fields.

## Relationship to other ADRs

An additive extension of the deck data model
([ADR 0004](0004-deck-data-model.md)); it supersedes nothing.
