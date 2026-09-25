# 0025: Primary artwork and the set facet

## Status

Accepted (#148, `feat/r6-card-data`). Extends
[0024](0024-passcode-aliases-and-catalog-cleanup.md).

## Context

ADR 0024 made a card's alternate artwork ids resolve to the card, but left
two questions open: which of a card's images is *its* picture, and what to
do with the sets the cleanup leaves without a card.

**The picture.** Every list picked the image with `min(image_url_small)`
(decks, inventory, wishlist, shared views, card entry) or the lowest image
id (catalog, inventory search, the assistant, the overlay's `images[0]`).
Neither is the card's main art. On a copy of the review database (14,636
cards, 14,807 images):

- 125 cards have more than one image.
- 32 of them have an image with their own id **and** a lower alternate id,
  so they showed the wrong art. Dark Magician (card 46986420) has the images
  36996508 and 46986414–46986421: every list, deck cover and overlay showed
  the 36996508 alternate art.
- For 1 card (101303084, a 9-digit id) `min(url)` and `min(id)` disagree, so
  a list and the overlay could already show different pictures.
- Every card with images has one whose id equals its card id. The one
  exception is retired 16178681, whose image belongs to 16178683, as ADR 0024
  intends.

**The empty sets.** `catalog_set` rows stay when the sync prunes printings
(ADR 0024), because format `setIds` reference set ids. 8 of the 1,030 sets
have no printing of an active card ("Duel Terminal 5/6/7", "The Lost Art
Promotion (series)", …). The catalog's set filter offered them, and picking
one found nothing.

## Decision

1. **Primary artwork = the image whose id is the card's id, else the one
   with the lowest id.** The own-id image is YGOPRODeck's main art, the
   passcode printed on the card.
   - One helper, `server/utils/card-image-sql.ts`:
     `primaryImageUrlSql(column)` is a scalar subquery for list selects,
     `primaryImageFirst()` the ORDER BY for a card's images.
   - Every list, cover and card-entry query uses it: catalog search,
     deck rows and covers, inventory list and card picker, inventory search,
     wishlist, shared deck and card lists, card-entry candidates. The
     `min(...)` aggregates, their image joins and the `GROUP BY`s they needed
     are gone; the remaining joins are 1:1.
   - The card detail returns its `images` primary-first, so the overlay's
     `images[0]` is the same picture as the lists.
   - Small and large URLs come from the same row: the ordering is
     deterministic because image ids are unique.
   - No new index. The subquery searches `idx_image_card (card_id=?)` and
     sorts at most ~9 rows: about 20–60 ms over all ~14.5k cards, under 1 ms
     for a sorted 24-card catalog page (offset 7000 included).
   - The subquery is a nested `sql` chunk. In a single-table select drizzle
     writes the selection's top-level column chunks without their table
     name, and an unqualified `id` inside the subquery would bind to the
     image's id.

2. **The set facet lists only sets with a printing of an active card.**
   "Active" matches the catalog's set filter, which also skips retired cards.
   - `GET /api/catalog/facets` returns them as `sets`, and the others as
     `setsWithoutCards`.
   - The rows stay. The format editor uses `setsWithoutCards` for names: a
     set a rule already names keeps its name in the rule summary and stays
     selectable in that editor. Empty sets aren't offered otherwise.

## Alternatives considered

- **A `primary_image_id` column set at sync.** Needs a migration and a sync
  change, for a sub-millisecond gain per page.
- **Pruning empty sets.** Breaks format references to them.
- **Showing the requested alias artwork on `?card=<artwork id>`.** Not done:
  the canonical card always shows its primary art.

## Consequences

- A card shows the same picture in every list, cover and overlay.
- The assistant's card search (`server/utils/assistant-tools.ts`) still
  picks the lowest image id. It follows once it orders by
  `primaryImageFirst()`.
- New list queries must use `primaryImageUrlSql()`, not an aggregate over
  `catalog_card_image`.
