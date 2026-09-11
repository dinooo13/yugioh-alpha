# 0004: Deck data model

## Status

Accepted

## Context

Phase 3 of the [Roadmap](../Roadmap.md) adds the deckbuilder: users create,
edit, and delete decks, fill main/extra/side areas from the cards they own,
track card counts, and see whether a deck is actually covered by their
inventory.

The roadmap's "Key Product Principle" already separates the concepts: a
catalog card is a global reference, an owned card is a user's copy of one,
a collection organizes owned cards, and *a deck is a saved construction*.
The data model has to keep that separation instead of collapsing decks into
inventory rows.

Two existing models constrain the design. Catalog cards
([ADR 0001](0001-card-catalog-data-model.md)) are global, immutable, and keyed
by the YGOPRODeck passcode. Owned cards
([ADR 0002](0002-owned-card-inventory-data-model.md)) are stacked per
`(user, card, printing, language, condition, edition)` tuple with a
`quantity`, explicitly so that "deck availability checks become a simple sum
by `catalog_card_id`".

## Decision

### A deck references catalog cards, not owned cards

`deck_card.catalog_card_id` references `catalog_card.id`. It deliberately does
**not** reference `owned_card.id`.

A deck is a construction — a list of *which cards* the deck plays — not a
reservation of specific physical copies. Referencing owned rows would mean a
deck list silently changes whenever the user re-assigns a card to another box,
corrects a condition, or splits/merges a stack (all of which create, delete,
or merge `owned_card` rows), and it would make it impossible to plan with a
card the user does not own yet.

Availability is therefore *derived at read time*: for every catalog card in a
deck the server sums `owned_card.quantity` for that user across all
collections, conditions, languages, and editions, and reports `owned`,
`usedInDeck`, and `shortfall = max(0, usedInDeck - owned)` per row. Nothing
about ownership is stored on the deck.

### Sections

`deck_card.section` is a text column holding `'main'`, `'extra'`, or `'side'`
— the three areas the roadmap names. Sections are a property of the deck
membership, not of the card and not of separate tables: the same catalog card
can legitimately appear in main *and* side, and a section list is always read
together with the rest of the deck, so three child tables (or a JSON blob)
would only add joins without adding meaning.

Which sections a card may enter follows from the card itself: Fusion, Synchro,
XYZ, and Link monsters belong to the Extra Deck and are rejected in `'main'`;
every other card is rejected in `'extra'`. `'side'` accepts both. That rule
lives in `shared/deck-sections.ts` so the server (validation) and the UI
(which buttons to offer) cannot drift apart.

### Quantity instead of one row per copy

Like `owned_card`, `deck_card` stores a `quantity` rather than one row per
physical copy. A deck list is read and rendered as "3× Dark Magician", the
quantity stepper in the editor maps directly onto it, and counts become
`sum(quantity)` instead of `count(*)`. A unique index over
`(deck_id, catalog_card_id, section)` makes that grain explicit and lets
writes be a plain upsert: setting a quantity of `0` deletes the row.

### Identity, ownership, and cascades

`deck.id` and `deck_card.id` are text UUID surrogate keys, matching
`collection`/`owned_card`. `deck.user_id` is a required FK to `user.id` with
cascade delete; `deck_card.deck_id` cascades from `deck`, and
`deck_card.catalog_card_id` cascades from `catalog_card`. Every deck endpoint
resolves the session via `requireUser(event)` and scopes reads *and* writes by
that user id, so touching another user's deck returns 404 rather than 403 —
the same ownership boundary as ADR 0002.

### Availability is per deck, never reserved across decks

Owned copies are not consumed by saving a deck. One physical Dark Magician may
appear in any number of saved decks, because decks are plans; only the
per-deck comparison "this deck uses 3, you own 2" is reported. Cross-deck
allocation would require a notion of an active/built deck that the product
does not have, and it would make a deck's completeness depend on unrelated
decks.

### Structural limits are warnings, not errors

`MAIN_MIN 40`, `MAIN_MAX 60`, `EXTRA_MAX 15`, `SIDE_MAX 15`, and
`MAX_COPIES 3` (per catalog card across main + side) are returned as
`limits` plus a `warnings` array on the deck detail. They are **not**
enforced as `400`s: Phase 4 introduces configurable rule formats where exactly
these numbers become format-dependent, and a deckbuilder must let a user save
a 12-card work in progress. Only structurally invalid writes are rejected: an
unknown card, an unknown section, a negative quantity, or a card placed in a
section its type forbids.

### No format or legality data here

`deck` intentionally carries no format, banlist, or legality columns. Rule
formats are Phase 4 and get their own model; a deck will then reference a
format additively (a nullable `format_id`), leaving this ADR's decisions
intact.

## Consequences

- Inventory edits never corrupt a deck list; a deck stays readable even if the
  user owns none of its cards (`owned: 0`, `shortfall: quantity`).
- Availability costs one extra aggregate query per read
  (`sum(owned_card.quantity) group by catalog_card_id`), which is bounded by
  the number of distinct cards in the deck and needs no denormalized counters.
- "Which of my decks use this card?" is a plain query on `deck_card`
  (`GET /api/decks?contains=<catalogCardId>`).
- Deck writes return the recomputed deck detail, so the client never has to
  re-read after a mutation and counts/warnings can never go stale.
- A future "build this deck from these exact copies" feature would need an
  additional allocation model; it is explicitly out of scope here.
