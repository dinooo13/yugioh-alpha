# 0019: Retired catalog cards

## Status

Accepted (#72, `fix/catalog-stale-cards`). Extends
[0001](0001-card-catalog-data-model.md).

## Context

`syncCatalog` (ADR 0001) only ever upserts. A card that YGOPRODeck no longer
lists stays in `catalog_card` for good. Most of these are pre-release
placeholders (passcodes like 101402024) that YGOPRODeck renumbered to the
real passcode once the card was released. A few are real passcode changes:
Odd-Eyes Pendulum Dragon moved from 16178681 to 16178683.

On a demo database that was re-synced in September 2026, 64 of 14,636 rows
were missing from the latest response (the "64 rows" in ADR 0015's
Consequences), and 62 card names appeared twice. Every catalog-wide search
showed those duplicates: "Adamancipator Conductor" came up twice in the
catalog, the deck editor, the inventory picker, quick entry and the
assistant. The stale copy has no German name, no printings and a frozen
banlist status.

What the stale rows look like:

- **No Konami id.** All 64 left YGOPRODeck before the first sync that stored
  Konami ids (ADR 0015). Their replacements do have one. Among the current
  placeholders (ids 100M–199M), 69 of 70 have no Konami id either. Where a
  Konami id exists it is unique among all rows, so it is a safe key, but a
  rare one.
- **The name is the usable key.** Matching the exact name against the
  active rows, restricted to the same `type`, after decoding a few HTML
  entities (old names were stored as "Graceful &amp; Skull Dice"), finds a
  unique replacement for 63 of 64 rows, with none ambiguous. The one miss,
  "Leviathan of Atlantis - Daedalus", was renamed at release to
  "Levia-Dragon of Atlantis - Daedalus".
- **The folded name is not.** `name_search` (ADR 0015) collides for real,
  distinct cards: "Hero Flash!!", "Raimei" and "Ectoplasmic Fortification"
  each have two active rows with the same folded name.

The stale rows can't simply be deleted: `owned_card`, `deck_card` and
`wishlist_item` reference `catalog_card` with `ON DELETE CASCADE`, so
deleting a catalog row would delete the user's inventory, deck and wishlist
entries with it.

## Decision

1. **Two columns, additive migration (0015).**
   - `catalog_card.retired_at`: NULL means active, i.e. listed by the latest
     YGOPRODeck sync. Otherwise it is the time of the sync that first found
     the card missing.
   - `catalog_card.replaced_by_id`: the active card this retired row was
     renumbered to, or NULL. A self-reference with `ON DELETE SET NULL`.
   - No index: `retired_at IS NULL` holds for almost every row, so an index
     wouldn't be selective.
   - No data step. Retirement needs the API response, so it happens on the
     next `catalog:sync`.

2. **Retirement by diffing the ids.** After the upsert, the sync compares
   the active ids with the ids of the response. The missing ones get
   `retired_at = now`. A guard protects against a truncated or broken
   response: if more than `max(200, 5 %)` of the active cards are missing,
   nothing is retired, the run logs a warning and reports
   `retirement.skipped`. The card upserts still apply.

3. **Replacement matching** (`pickReplacement` in
   `server/utils/catalog-retire.ts`), for every retired row, on every sync:
   1. the only active row with the same Konami id (if several share it, the
      only one of them with the same decoded name);
   2. else the only active row with the same decoded name **and** type;
   3. else the end of the row's old `replaced_by_id` chain, followed to the
      first active row (at most 10 hops). This keeps A → B valid when B
      retires later and is itself replaced by C: A then points to C.

   Otherwise the row stays retired without a replacement. The folded name is
   not used, because it collides for real cards.

4. **References move to the replacement automatically**, in the same
   transaction as the retirement. The remap is idempotent, so references
   created after a sync get fixed by the next one. A sync is not a user
   edit, so `updated_at` is never bumped.

   | Where | What happens |
   |---|---|
   | `owned_card` | If the user already has a row for the replacement in the same collection, the rows merge like any two rows with the same `(user, card, collection)` tuple (ADR 0017): the quantities add up, the distinct notes are joined, the later `updated_at` is kept. Otherwise the row just points to the replacement. |
   | `deck_card` | If the deck already has the replacement in the same section, the quantities add up, capped at 99. Otherwise the row just points to the replacement. |
   | `deck.cover_card_id` | Points to the replacement. |
   | `wishlist_item` | If the replacement is already on the wishlist, the higher quantity wins (a wish, not a stock) and the existing note is kept. Otherwise the item just points to the replacement. |
   | `rule_format` (user formats) | The card ids in `card_status` rules and in `filter.cardIds` are replaced, de-duplicated. Built-in formats reference no card ids. |

   **Never rewritten:** tournament deck snapshots (history, ADR 0008; the
   retired row keeps resolving), pending assistant action payloads (applying
   a stale one writes the old id, and the next sync moves it), translations,
   printings and images.

5. **Visibility.**
   - Every **catalog-wide** search and picker hides retired rows through
     `activeCatalogCard()` (`server/utils/card-name-search.ts`): the catalog
     list and its facets (which also serve the deck editor's catalog mode
     and the format editor's card picker), the inventory picker, the quick
     entry pools and set codes, and the assistant's `search_catalog`.
   - Searches over a user's **own references** (inventory, wishlist, decks,
     shared views) and every **lookup by id** (the card detail, `get_card`,
     deck validation, writes) keep resolving retired rows.
   - In quick entry, a retired passcode resolves to its replacement, so a
     passcode printed on a real card (16178681) still finds the card.
   - The card detail and `get_card` report `retired` and `replacedById`
     (`get_card` only for a retired card, so the output for active cards is
     unchanged). Deck rows, wishlist items and the inventory list and
     overview carry a `retired` flag, and the UI marks those cards with a
     small "No longer in the catalog" badge. In practice that is a card
     without a replacement, because the sync has moved every other
     reference.

6. **Un-retiring.** A card that shows up in the response again gets
   `retired_at` and `replaced_by_id` reset by the upsert. The sync reports
   it under `retirement.restored`.

## Alternatives considered

- **Deleting the rows.** Impossible without losing user data (the cascades
  above), and it would break tournament snapshots that still show the card.
- **A `last_seen_sync_id` column.** Every row would change on every sync.
  The in-memory diff against the response is simpler and doesn't depend on
  timestamps (`synced_at` has second precision).
- **Keep the rows and only show a hint.** References would stay on stale
  data: no German name, no printings, a frozen banlist status, and a card
  that no longer shows up in any search.
- **Matching on `name_search`.** It collides for real, distinct cards.

## Consequences

- Retired rows stay in the database for good. They cost almost nothing
  (64 rows today).
- A card that YGOPRODeck lists twice at the same time still shows up twice;
  only cards missing from the response are retired.
- Printings and images that no card lists any more are not cleaned up.
- Name-based matching is a heuristic. It is deliberately conservative
  (exact name, same type, unique), so a placeholder that gets a new name at
  release stays retired without a replacement, and its references keep the
  badge.
- The sync edits user data. It does so in one transaction, without bumping
  timestamps, and never touches history.
