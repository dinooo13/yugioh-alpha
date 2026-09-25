# 0024: Passcode aliases and catalog cleanup

## Status

Accepted (#113, #111, #108, #107, #109; `feat/r5-retired-cards`). Extends
[0019](0019-retired-catalog-cards.md).

## Context

ADR 0019 retires the catalog rows YGOPRODeck no longer lists and moves the
users' references to a replacement. Four gaps were left.

**#113: "Dark Magician changed from 46986414 to 46986420."** It didn't, not
in any real database. On a copy of the demo database, before and after a full
sync:

- Dark Magician is card **46986420** (Konami id 4041), and has been since
  the first sync (July 2026, 14,422 cards). No `catalog_card` row 46986414
  has ever existed.
- 46986414, the passcode printed on the original card, is an **artwork id**:
  YGOPRODeck lists the card's nine artworks as image rows 46986414–46986421
  and 36996508, all with `card_id` 46986420.
- Only the E2E and unit fixtures use 46986414 as a card id.

So the ADR 0019 remap never had anything to do for Dark Magician. The real
gap is that a printed passcode YGOPRODeck keeps as an alternate artwork
finds nothing: `/catalog?card=46986414` showed "Karte nicht gefunden",
quick entry (and the README's example) found no candidate, and the
assistant's `get_card 46986414` failed.

**#111: nothing is cleaned up.** The sync only upserts. After the first
sync with retirement on that copy (14,572 cards in the response; 64 rows
retired, 49 with a replacement, 15 without), 63 image rows still hung on
retired cards: the placeholder pictures of cards that live on under another
passcode. Printings and images YGOPRODeck drops from a listed card stay too.

**#108, #107, #109: the retired status is hard to see.** The card overlay
and the public shared views didn't show it, the badge's hint was a hover
tooltip (unreachable on phones), and the deck editor didn't say that a
deck holds a card whose banlist status no longer updates.

## Decision

1. **Artwork-id aliases on lookups by id** (`server/utils/card-passcode.ts`).
   - `resolveCatalogCardId(db, id)`: the card row with that id (active or
     retired), else the card that lists an artwork with that id, else
     `null`. A card row always wins, so a retired row keeps resolving to
     itself and shows its retired status.
   - `resolvePasscode(db, passcode)`: the same, then a retired card with a
     replacement resolves to the replacement (ADR 0019).
   - Used by the card detail (`GET /api/catalog/cards/:id`, and through it
     the catalog deep link, every card overlay and the assistant's
     `get_card`), quick entry's passcode match and the inventory's card
     picker. The detail's `card.id` is the canonical id; the overlay emits
     it (`resolved`) and the catalog puts it into its URL
     (`?card=46986414` becomes `?card=46986420`), so the wishlist toggle
     acts on the real card.
   - **Writes don't alias.** Inventory, deck and wishlist writes take
     canonical card ids.

2. **The sync deletes printings and images the response no longer lists**
   (`pruneUnlistedCatalogRows` in `server/utils/catalog-retire.ts`), after
   the retirement, in one transaction. It reports
   `cleanup: { printings, images, skipped }`.
   - **The guard covers it:** when retirement is skipped (the response looks
     truncated), nothing is pruned (`cleanup.skipped`).
   - **Exceptions:** retired cards **without** a replacement keep their
     printings and images; their image is the only picture of a card users
     may still hold. `catalog_set` rows stay (format set filters reference
     set ids), and so do the translations.
   - Deleting a printing sets the legacy `owned_card.printing_id` to NULL
     through its FK (`ON DELETE SET NULL`). That column has been hidden
     since ADR 0017, so no user data is lost.
   - Retired rows with a replacement lose their placeholder image; the
     overlay and thumbnails already handle a card without one.

3. **Link monsters have no level.** YGOPRODeck sends `level: 0` for Link
   monsters (108 cards), so the level facet's "0" matched them and format
   level ranges treated them as level 0. The mapper stores `null` for them;
   the next sync fixes existing rows.

4. **The retired status shows wherever a card is shown.**
   - The card overlay shows an alert at the top of its right column; with a
     replacement it links to the current card in the catalog.
   - Shared decks, shared inventories and collections and the public
     wishlist teaser carry a `retired` flag (not the date) and show the
     badge with a hint for visitors.
   - The badge's hint opens on click/tap (a popover) instead of on hover.
   - The deck editor shows a `card_retired` **warning** for every retired
     card in a deck, also when a format is assigned. It is not a validation
     issue: format legality doesn't change, and the rule engine stays
     untouched.

## Alternatives considered

- **Status quo for #113.** Printed passcodes would keep failing for every
  card with alternate artworks, including the README's own example.
- **Pruning the images of all retired rows.** It would strip the only
  picture of the 15 placeholders without a replacement, which users may
  still hold.
- **Renumbering the fixture's Dark Magician to 46986420.** About 15 E2E
  specs use 46986414, its real printed passcode, and the alias covers the
  real-data id. The fixture instead gains the alias artwork 46986420, the
  retired old Odd-Eyes row (16178681 → 16178683) and a retired placeholder
  without a replacement, as a real sync leaves them.
- **Aliasing writes too.** API clients would store whatever id they sent;
  canonical ids keep one row per card.

## Consequences

- Every printed passcode YGOPRODeck lists as an artwork resolves, in the
  catalog, quick entry, the inventory picker and the assistant.
- On the demo copy, the second sync deleted 48 placeholder images and no
  printings; a third sync deleted nothing. The images left on retired rows
  (15) belong to the cards without a replacement.
- Card lists still show the lowest image id as a card's picture, so Dark
  Magician shows its 36996508 artwork. Preferring the image whose id equals
  the card id is left open.
- `catalog_set` rows without printings (8 on the demo copy) stay in the set
  facet with zero results.
