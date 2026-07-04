---
# yugioh-alpha-4d77
title: Search across the full inventory
status: todo
type: feature
priority: normal
tags:
    - area:inventory
    - area:ui
    - agent-ready
    - effort:medium
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T21:10:05Z
parent: yugioh-alpha-brmu
blocked_by:
    - yugioh-alpha-f785
---

## Problem

Users must be able to answer "which cards do I own, how many, and where are they?" across their complete inventory, regardless of how cards are split across collections.

## Proposed Solution

- Inventory-wide search/filter API + UI: card name and catalog properties (type, attribute, ...) combined with ownership fields (language, condition, collection).
- Results show total owned quantity and where copies are stored (per-collection breakdown).

## Effort

Medium

Depends on the owned-card model (blocked-by), and is most useful once collections exist.

<!-- routine:plan -->
## Plan

> Add **inventory-wide search & filtering**: a single read endpoint (`GET /api/inventory/search`) plus a search/filter panel on `app/pages/inventar.vue` that answers "which cards do I own, how many, and where?" — combining card-name/text and **catalog** facets (type, attribute, race, level, set) with **ownership** facets (language, condition, edition, collection), returning aggregated results with **total owned quantity** and a **per-collection quantity breakdown** per card. Builds on wxy4's `owned_card` model and f785's `collection` model; it deliberately does *not* duplicate wxy4's plain `GET /api/inventory` list or f785's single-collection `?collectionId=` filter.

### Dependency assumptions (blocked-by yugioh-alpha-wxy4 and yugioh-alpha-f785)

This plan is written **against the approved plans in wxy4 and f785** and assumes both land first. It relies on:

**From wxy4 (`owned_card` model + inventory endpoints):**
- `owned_card` in `server/db/schema.ts`: surrogate **text UUID `id`**, `user_id` (text notNull → `user.id`), `catalog_card_id` (integer FK → `catalog_card.id`), `printing_id` (text nullable FK → `catalog_printing.id`), `quantity` (integer), enumerated `language`/`condition`/`edition` (text), `note`, `created_at`/`updated_at`. Indexes `idx_owned_card_user`, `idx_owned_card_user_card`.
- `server/utils/session.ts` `requireUser(event)` (401 if no session) — reused by the search handler.
- `server/utils/inventory.ts` — allowed-value constants (`LANGUAGES`, `CONDITIONS`, `EDITIONS`) and the **catalog-join select builder**. This bean **reuses** those constants and join for its result rows rather than re-deriving them.
- `GET /api/inventory` (`server/api/inventory/index.get.ts`) is the plain per-row list (`?q=`/pagination). This bean adds a *separate* aggregating endpoint; it does not modify wxy4's list handler.

**From f785 (collections):**
- `collection` table: text UUID `id`, `user_id`, `name`, `description`. `owned_card.collection_id` (text nullable FK → `collection.id`, set null). Index `idx_owned_card_collection`.
- `server/utils/collections.ts` `assertCollectionOwnedByUser(db, userId, collectionId)`.
- Because f785 adds `collection_id` to wxy4's upsert-match tuple, **the same card can occupy multiple `owned_card` rows** (one per collection) — this is exactly what makes a per-collection quantity breakdown meaningful and is why this bean **aggregates** owned rows by `catalog_card_id` rather than listing them raw.

**From the catalog (23wn / 82gj, upstream, not blocking):**
- `catalog_card` columns (`name`, `type`, `attribute`, `race`, `level`, `atk`, `def`, `frame_type`, …) and `catalog_card_image` / `catalog_printing` / `catalog_set` per 23wn's schema. This bean joins them read-only, mirroring 82gj's query approach. It reuses 82gj's LIKE-escaping/param-coercion style but does **not** depend on 82gj's endpoints (catalog search is a distinct surface).

If any upstream PK/column/export name deviates from the above, the implementer adapts the query/join layer to the shipped names; the API contract in §2 and the aggregation model stay stable. If wxy4 or f785 has not merged when this is picked up, it stays blocked (do not stub their schema).

### 1. Overview

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Result grain | **One row per `catalog_card_id`** (aggregated across all the user's owned rows), carrying `totalQuantity = SUM(quantity)` and a `collectionBreakdown[]` — not raw per-`owned_card` rows (that's wxy4's `GET /api/inventory`). |
| Q2 | Per-collection breakdown | Each result card includes `collectionBreakdown: [{ collectionId, collectionName, quantity }]` (with a `null` collectionId bucket = "Alle Karten"/unassigned). Computed server-side in one grouped query. |
| Q3 | API surface | **New `GET /api/inventory/search`** (distinct from wxy4's `/api/inventory` list and f785's `?collectionId=` filter). Read-only, aggregating, faceted. |
| Q4 | Filter dimensions | **Catalog facets** (`q` name/text, `type`, `attribute`, `race`, `level`, `setId`) **+ ownership facets** (`language`, `condition`, `edition`, `collectionId`), all scoped to the user's owned cards and AND-combined. |
| Q5 | `collectionId` semantics here | A filter that **restricts which owned rows are considered** but results still show that card's *full* breakdown? → **No**: `collectionId` filters to cards that have ≥1 copy in that collection; the breakdown still lists **all** collections that card lives in (so you see the full picture). A dedicated `collectionId=__none__` selects unassigned. |
| Q6 | Text search | SQLite `LIKE '%term%'` (case-insensitive) on `catalog_card.name`, opt-in `inText=1` also matches `catalog_card.desc`; `%`/`_` escaped. Mirrors 82gj; no FTS. |
| Q7 | Pagination & sort | Offset/limit (`page`, `pageSize=24`, cap 60) over the **aggregated** result; `total` = distinct owned card count matching filters. Sort: `name` (default), `-name`, `quantity` (total desc), `newest` (`tcg_date` desc). |
| Q8 | Aggregation strategy | Two coordinated queries in the handler: (1) grouped page of `catalog_card_id` with `SUM(quantity)` + count for pagination; (2) breakdown + catalog display fields for the page's card ids. Pure builders in a new `server/utils/inventory-search.ts`. |
| Q9 | Auth & ownership | `requireUser(event)`; every query filtered by `owned_card.user_id = session user`; `collectionId` validated via f785's `assertCollectionOwnedByUser`. |
| Q10 | Facet option values | Reuse wxy4's ownership enums (`LANGUAGES`/`CONDITIONS`/`EDITIONS`) and f785's `GET /api/collections` for selects; catalog facet values (types/attributes/etc. **present in the user's inventory**) come from a small `GET /api/inventory/search/facets` so filters only offer values the user actually owns. |
| Q11 | UI placement | Extend `app/pages/inventar.vue` with a search/filter panel + an **aggregated results mode** (toggle or default view) showing total quantity and a per-collection breakdown chip/popover per card. Does not remove wxy4's raw list/edit/remove affordances. |
| Q12 | ADR | **No new ADR.** Read-only aggregating query over schemas already governed by wxy4's inventory ADR (and 23wn's catalog ADR). No new persistence/auth/dependency/cross-cutting pattern. Any read-optimizing index is additive. |

### 2. Search API

New routes under `server/api/inventory/`. All use `useDb()` + Drizzle and call `requireUser(event)` first, scoping every read to `owned_card.user_id = user.id`.

#### `GET /api/inventory/search` — faceted, aggregated inventory search

Query params (all optional):

| Param | Type | Meaning |
|-------|------|---------|
| `q` | string | case-insensitive `LIKE` substring on `catalog_card.name` |
| `inText` | `0\|1` | when `1`, also match `catalog_card.desc` |
| `type` | string (repeatable/CSV) | catalog `type` IN (…) |
| `attribute` | string (repeatable/CSV) | catalog `attribute` IN (…) |
| `race` | string (repeatable/CSV) | catalog `race` IN (…) |
| `level` | integer (repeatable/CSV) | catalog `level` IN (…) |
| `setId` | string | card has a `catalog_printing` in that set |
| `language` | string (repeatable/CSV) | ownership `owned_card.language` IN (…) |
| `condition` | string (repeatable/CSV) | ownership `owned_card.condition` IN (…) |
| `edition` | string (repeatable/CSV) | ownership `owned_card.edition` IN (…) |
| `collectionId` | string (or `__none__`) | card has ≥1 owned row in that collection (`__none__` = unassigned) |
| `sort` | `name\|-name\|quantity\|newest` | default `name` asc |
| `page` | integer ≥1 | default 1 |
| `pageSize` | integer 1–60 | default 24 |

Behavior:
- Validate/clamp params (manual coercion, no Zod — matches wxy4/82gj). Unknown enum values dropped; invalid paging → defaults.
- Build a `WHERE` over `owned_card` joined to `catalog_card` (inner) — ownership filters constrain `owned_card`; catalog filters constrain `catalog_card`; `setId`/`collectionId` via `EXISTS` subqueries. AND across all facets.
- **Aggregation:** `GROUP BY owned_card.catalog_card_id`, `SUM(owned_card.quantity) AS totalQuantity`. `total` (for pagination) = number of distinct matching `catalog_card_id`. Page the grouped result (order + limit/offset).
- **Breakdown:** for the page's card ids, a second query groups by `(catalog_card_id, collection_id)` summing quantity, left-joined to `collection` for the name — assembled into `collectionBreakdown[]` per card. The `null` collection bucket is labelled "Alle Karten"/"(keine Sammlung)" in the UI, not stored.
- **Display fields:** join `catalog_card` (name, type, attribute, race, level, atk, def, frameType) and the primary `catalog_card_image` (`image_url_small`, lowest image id — same technique as 82gj).

Response:
```json
{
  "items": [
    {
      "catalogCardId": 89631139,
      "name": "Blue-Eyes White Dragon",
      "type": "Normal Monster",
      "attribute": "LIGHT",
      "race": "Dragon",
      "level": 8,
      "atk": 3000,
      "def": 2500,
      "imageSmall": "https://images.ygoprodeck.com/.../89631139.jpg",
      "totalQuantity": 5,
      "collectionBreakdown": [
        { "collectionId": "uuid-box1", "collectionName": "Box 1", "quantity": 3 },
        { "collectionId": null, "collectionName": null, "quantity": 2 }
      ]
    }
  ],
  "total": 1, "page": 1, "pageSize": 24
}
```

#### `GET /api/inventory/search/facets` — filter option values scoped to the user's inventory

Returns only values the user actually owns, so filters never offer empty facets:
```json
{
  "types": ["Normal Monster", "Effect Monster", "Spell Card"],
  "attributes": ["LIGHT", "DARK"],
  "races": ["Dragon", "Spellcaster"],
  "levels": [1,4,8],
  "sets": [{ "id": "legend-of-blue-eyes-white-dragon", "name": "Legend of Blue Eyes White Dragon" }],
  "languages": ["en","de"],
  "conditions": ["near_mint","played"],
  "editions": ["first","unlimited"]
}
```
`SELECT DISTINCT` per catalog/ownership column across the user's owned rows (joined to `catalog_card`/`catalog_printing`/`catalog_set`). Collections for the select come from f785's existing `GET /api/collections` (not duplicated here).

**Affected files (new):**
- `server/api/inventory/search/index.get.ts` — the aggregated search endpoint.
- `server/api/inventory/search/facets.get.ts` — inventory-scoped facet values.
- `server/utils/inventory-search.ts` — pure helpers: `parseInventorySearchQuery(rawQuery)` (coerce/clamp → typed filters, reusing wxy4's `LANGUAGES`/`CONDITIONS`/`EDITIONS` to drop invalid enum values) and `buildInventorySearchWhere(userId, filters)` (returns Drizzle conditions, incl. `setId`/`collectionId` EXISTS subqueries). Extracted for unit-testability without HTTP.

**Reused (not modified):** `server/utils/session.ts` (`requireUser`), `server/utils/inventory.ts` (enums + catalog-join fields), `server/utils/collections.ts` (`assertCollectionOwnedByUser`).

### 3. UI

Extend `app/pages/inventar.vue` (already the real inventory view from wxy4 + collection filter from f785) with a **search & filter panel** and an aggregated results view.

Wireframe:
```
+------------------------------------------------------------------+
| Inventar                                   [ + Karte hinzufügen ] |
| [ 🔎 Im Inventar suchen…      ] [inTextᵕ]  [ Liste | Übersicht ]  |
| Katalog:  [Typ ▾][Attribut ▾][Rasse ▾][Level ▾][Set ▾]           |
| Besitz:   [Sprache ▾][Zustand ▾][Auflage ▾][Sammlung ▾]  [Reset] |
+------------------------------------------------------------------+
| 37 Karten                                    Sortierung: Name ▾   |
| +----+-------------------------+----------+------------------------+
| |img | Blue-Eyes White Dragon  |  ×5 ges. | Box 1 ×3 · (keine) ×2 |
| |    | Normal Monster · LIGHT  |          | [Aufschlüsselung ▾]   |
| +----+-------------------------+----------+------------------------+
| |img | Dark Magician           |  ×2 ges. | Binder ×2             |
| +----+-------------------------+----------+------------------------+
|                                   ‹ 1 2 3 ›   (UPagination)       |
+------------------------------------------------------------------+
```

Behavior:
- A reactive `filters` ref `{ q, inText, type[], attribute[], race[], level[], setId, language[], condition[], edition[], collectionId, sort, page }`. `q` debounced (~300 ms); any filter change resets `page` to 1.
- `useFetch('/api/inventory/search', { query: filters })` drives the aggregated grid/table; loading → skeletons; error → `UAlert`.
- Facet selects populated once from `useFetch('/api/inventory/search/facets')`; the "Sammlung" select from f785's `/api/collections`. `USelectMenu` for multi-value catalog/ownership facets.
- Each result shows `totalQuantity` prominently and a **per-collection breakdown** (inline chips for ≤2 collections, else a `UPopover`/`UDropdownMenu` "Aufschlüsselung"). The `null` bucket renders as "(keine Sammlung)".
- A "Liste | Übersicht" toggle switches between wxy4's raw per-row list (edit/remove) and this aggregated search view. Default: aggregated ("Übersicht") when any search/filter is active; the panel is the primary way to answer "where are my copies?".
- If `?collectionId=` is present in the route (f785's sidebar deep-link), it pre-selects the collection facet so the sidebar and search stay consistent.
- Empty states: distinguish "Inventar ist leer" (no owned cards at all → CTA to add) from "keine Treffer für diese Filter" (filters active, no matches).

**Affected files:**
- Touched: `app/pages/inventar.vue` — add the search/filter panel + aggregated results view + view toggle.
- New (optional extraction if the page grows unwieldy): `app/components/inventory/InventorySearchPanel.vue` (filter controls), `app/components/inventory/InventoryResultRow.vue` (aggregated row + breakdown popover). MVP may keep them inline.
- No change to `app/layouts/default.vue` here (f785 owns the sidebar); this bean only reads `?collectionId=` if set.

### 4. Data flow

```
inventar.vue (filters ref)
   │  useFetch (debounced)
   ▼
GET /api/inventory/search ─► requireUser ─► parseInventorySearchQuery
                                            buildInventorySearchWhere(userId, filters)
                                            ─► Q1: GROUP BY catalog_card_id,
                                                   SUM(quantity), COUNT(distinct) → page + total
                                            ─► Q2: for page ids, GROUP BY
                                                   (catalog_card_id, collection_id) → breakdown
                                            ─► join catalog_card + primary image
   ◄── { items:[{…, totalQuantity, collectionBreakdown[]}], total, page, pageSize }
   │
   ├─ facets: GET /api/inventory/search/facets (once, inventory-scoped)
   └─ collections select: GET /api/collections (f785)
```

### 5. Business logic & edge cases

- Ownership boundary: every query includes `owned_card.user_id = session user`; no cross-user reads. `collectionId` validated with `assertCollectionOwnedByUser` (foreign/unknown → 400; `__none__` needs no validation).
- `q` escapes `%` and `_` before wrapping in `%…%`; case-insensitive (SQLite ASCII `LIKE`).
- `level`/paging coerced and clamped; non-numeric `level` entries dropped; invalid enum values (language/condition/edition/type/…) dropped rather than 500.
- A card owned only as unassigned copies still appears; its breakdown is a single `null` bucket. A card split across a collection **and** unassigned shows both buckets summing to `totalQuantity`.
- `collectionId=<id>` filters to cards with ≥1 copy there but the returned breakdown still lists *all* that card's collections (full picture) — documented in the endpoint and covered by a test.
- Cards with no image → `imageSmall: null`; UI shows a placeholder tile.
- Sort `quantity` orders by `SUM(quantity)` desc, tie-break by name; `newest` by `catalog_card.tcg_date` desc nulls last.
- Empty inventory (no owned rows) → `{ items: [], total: 0 }`; facets endpoint returns empty arrays; UI shows the "leer" empty state.

### 6. Schema / index impact (additive only)

**No table shape changes.** The breakdown query groups by `(catalog_card_id, collection_id)` over `owned_card`, already covered by wxy4's `idx_owned_card_user_card` and f785's `idx_owned_card_collection`. If, on measurement, grouped filtering is slow on realistic inventories, the implementer **may** additively add a composite index (e.g. `idx_owned_card_user_card_collection` on `(user_id, catalog_card_id, collection_id)`) via a new generated migration (`pnpm db:generate`, applied by `server/plugins/migrate.ts`). This is additive and does not reopen wxy4's/f785's ADRs. Treat it as optional — inventory sizes are modest for Phase 1.

### Dependencies

None new. Reuses `drizzle-orm`, `better-sqlite3`, `better-auth` (`requireUser`), Nuxt `useFetch`/`$fetch`, Nuxt UI 4 (`UInput`, `USelectMenu`, `UPagination`, `UPopover`, `UBadge`, `USkeleton`), `crypto` (none needed — read-only). Validation stays hand-rolled (no Zod), matching wxy4/82gj.

### Docs & ADR impact

- **No new ADR required.** This is a read-only aggregating query + UI over schemas already governed by wxy4's "Owned-card (inventory) data model" ADR (and 23wn's catalog ADR). It introduces no new persistence, auth model, core dependency, or cross-cutting pattern; any index is additive. Justification recorded here per WORKFLOW §7.
- `docs/Roadmap.md` — no change (this delivers Phase 1's "search across the user's full inventory"; design conforms to the catalog/owned/collection separation principle).
- `README.md` — optional one-line note that the inventory is searchable across collections with per-collection quantity breakdowns (verify at build).

### Test plan

| # | Test case | Type | Steps | Expected |
|---|-----------|------|-------|----------|
| 1 | `parseInventorySearchQuery` clamps paging & drops bad enums | unit | `page=0`,`pageSize=999`,`condition=bogus`,`level=abc` | `page=1`, `pageSize=60`, unknown condition & non-numeric level dropped |
| 2 | `parseInventorySearchQuery` parses multi-value facets | unit | `type=A,B`, repeated `language` | arrays `['A','B']`, both languages |
| 3 | `buildInventorySearchWhere` escapes LIKE wildcards & scopes user | unit | `q="50%_off"`, userId | `%`/`_` escaped; `owned_card.user_id` condition present |
| 4 | Aggregates owned rows by catalog card with total quantity | nuxt (in-memory better-sqlite3, seeded catalog+owned) | user owns same card in Box 1 (×3) + unassigned (×2); search | one item, `totalQuantity: 5` |
| 5 | Per-collection breakdown correct | nuxt | same seed as #4 | `collectionBreakdown` = Box 1 ×3 and null-bucket ×2 |
| 6 | Catalog facet filter (type/attribute) | nuxt | seed monsters + spells; `type=Spell Card` | only spell cards returned |
| 7 | Ownership facet filter (condition) | nuxt | seed same card in two conditions | `condition=near_mint` returns only near-mint copies' aggregate |
| 8 | `collectionId` filters cards but keeps full breakdown | nuxt | card in Box1(×3)+unassigned(×2); `collectionId=Box1` | card returned; breakdown still shows both buckets |
| 9 | `collectionId=__none__` selects unassigned | nuxt | mix of assigned/unassigned | only cards with unassigned copies |
| 10 | Name search case-insensitive + escaped | nuxt | seed "Blue-Eyes…"; `q=blue` | matched; `%`/`_` not treated as wildcards |
| 11 | Sort by quantity / newest | nuxt | seed cards with differing totals & tcg_date | `sort=quantity` desc; `sort=newest` by tcg_date |
| 12 | Pagination over aggregated results | nuxt | seed 30 distinct owned cards; `pageSize=10&page=2` | ≤10 items; correct `total`=30, `page`=2 |
| 13 | Ownership boundary | nuxt | seed owned rows for user A & B; search as A | only A's cards aggregated; B's excluded |
| 14 | Foreign/unknown `collectionId` rejected | nuxt | search with another user's collection id | 400 |
| 15 | Facets endpoint returns only owned values | nuxt | seed subset of types/attributes/languages | distinct owned values only; empty arrays when inventory empty |
| 16 | Unauthenticated requests rejected | nuxt/e2e | call `/api/inventory/search` & `/facets` w/o session | 401 |
| 17 | Inventory search panel renders + shows breakdown | nuxt (`mountSuspended`, mocked fetch) | mount `inventar.vue` with stubbed search/facets | filter controls, total qty, and per-collection breakdown shown; empty states distinguish leer vs. keine Treffer |

Done = the project's verification gates green (WORKFLOW §5): `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` (and `pnpm test:e2e` for the auth-guard case #16 if the session-backed e2e harness is available), with tests for every behavior change.

### Suggested classification & branch

Tags: `effort:medium` (keep — one aggregating endpoint + a facets endpoint + a search panel/aggregated view on an existing page; read-only, no schema change), `area:inventory` (keep), add `area:ui` (the search/filter panel + breakdown view is a substantial UI part). Branch: `claude/4d77-inventory-search`.

### Out of scope

- The `owned_card` model, plain inventory list/add/edit/remove, and the `AddToInventoryModal` (owned by wxy4).
- The `collection` table, collection CRUD, sidebar, and single-collection `?collectionId=` list filter (owned by f785). This bean reuses `/api/collections` and reads `?collectionId=` but does not modify them.
- Catalog search UI/API `/api/catalog/*` and `/katalog` (owned by 82gj) — this is a *distinct* surface over owned cards, not the global catalog.
- Saved searches / smart collections, CSV export of results, bulk actions on search results.
- Full-text/fuzzy ranking (MVP is substring `LIKE`; revisit with SQLite FTS5 later).
- Value/price aggregation of matched cards (Phase-later).
- Cross-user/shared inventory search (Phase 6).

<details>
<summary>Brainstorming record (auto-resolved)</summary>

#### Round 1: Result grain & aggregation
##### Q1. What is the grain of a search result row?
- [x] **One aggregated row per `catalog_card_id`** — (Recommended) directly answers "how many do I own and where?"; distinct from wxy4's raw per-`owned_card` list; makes total quantity + breakdown natural.
- [ ] **Raw per-`owned_card` row** — duplicates wxy4's `GET /api/inventory`; forces the client to aggregate; loses the "full picture across collections" goal.
- [ ] **One row per (card, collection)** — closer to storage but scatters a card across rows; the breakdown is better modelled as a nested array.

##### Q2. How is the per-collection breakdown produced?
- [x] **Server-side, grouped `(catalog_card_id, collection_id)` SUM, nested `collectionBreakdown[]`** — (Recommended) single source of truth, thin client, `null` bucket for unassigned.
- [ ] **Client aggregates from raw rows** — needs the full row set client-side; breaks pagination.
- [ ] **Separate per-card breakdown endpoint** — extra round trips per card; the panel wants it inline.

##### Q3. New endpoint vs. extending wxy4's `/api/inventory`?
- [x] **New `GET /api/inventory/search`** — (Recommended) different shape (aggregated + faceted); keeps wxy4's list handler simple and its contract stable.
- [ ] **Overload `/api/inventory` with an `aggregate=1` mode** — conflates two response shapes on one route; harder to type/test.

| Q | Choice |
|---|--------|
| Q1 | Aggregated per catalog card |
| Q2 | Server-side grouped breakdown |
| Q3 | New /inventory/search endpoint |

#### Round 2: Filters, collectionId semantics, text search
##### Q4. Which filter dimensions ship?
- [x] **Catalog facets (q/type/attribute/race/level/set) + ownership facets (language/condition/edition/collection)** — (Recommended) exactly the bean's "card name + catalog properties + ownership fields"; all map to indexed/simple columns or a join.
- [ ] **Catalog facets only** — misses the ownership dimension the bean explicitly calls out.
- [ ] **Add atk/def ranges, archetype now** — scope creep beyond the bean; defer (82gj deferred these too).

##### Q5. What does `collectionId` mean in an inventory-wide search?
- [x] **Filter to cards with ≥1 copy in that collection, but still return the full breakdown** — (Recommended) preserves the "where are all my copies?" answer even while narrowing which cards show; add `__none__` for unassigned.
- [ ] **Filter *and* restrict the breakdown to that collection** — reduces to f785's single-collection list; loses the cross-collection value of this bean.
- [ ] **No collection filter (rely on f785's sidebar)** — the bean wants combining ownership+catalog facets including collection.

##### Q6. Text search matching?
- [x] **`LIKE '%term%'` on name, opt-in `desc`, wildcards escaped** — (Recommended) zero new deps, consistent with 82gj, fine at Phase-1 scale.
- [ ] **SQLite FTS5** — better ranking, extra schema/sync; premature.
- [ ] **Client-side filtering** — needs the whole inventory client-side; breaks pagination.

| Q | Choice |
|---|--------|
| Q4 | Catalog + ownership facets |
| Q5 | Filter but keep full breakdown; `__none__` for unassigned |
| Q6 | LIKE substring, escaped |

#### Round 3: Pagination, facet values, auth
##### Q7. Pagination & sort over aggregated results?
- [x] **Offset/limit with `total` = distinct matching cards; sort name/-name/quantity/newest** — (Recommended) supports `UPagination`; `quantity`/`newest` sorts serve the "how many / recent" questions.
- [ ] **Cursor/keyset** — unnecessary complexity at this scale.
- [ ] **No pagination** — an inventory can be large; unbounded payloads are wasteful.

##### Q8. Where do filter option values come from?
- [x] **Inventory-scoped `GET /api/inventory/search/facets` + wxy4 enums + f785 `/api/collections`** — (Recommended) filters only offer values the user actually owns; no duplication of collection listing.
- [ ] **Reuse 82gj's catalog `/facets`** — offers global catalog values (thousands of types/sets the user doesn't own); noisy for an inventory search.
- [ ] **Hard-code option lists in the UI** — drifts from real data; can't reflect owned sets.

##### Q9. Auth & ownership enforcement?
- [x] **`requireUser` + `owned_card.user_id` filter everywhere + `assertCollectionOwnedByUser`** — (Recommended) reuses wxy4/f785 patterns exactly; consistent 401/400.
- [ ] **Trust client-provided user id** — insecure; violates ownership boundary.

| Q | Choice |
|---|--------|
| Q7 | Offset/limit + quantity/newest sorts |
| Q8 | Inventory-scoped facets + reuse collections |
| Q9 | requireUser + ownership filter |

#### Round 4: UI, index, ADR
##### Q10. Where does the search UI live?
- [x] **Extend `app/pages/inventar.vue` with a filter panel + aggregated "Übersicht" view (toggle with wxy4's list)** — (Recommended) inventory is one place; complements wxy4's list and f785's sidebar; reads `?collectionId=` for consistency.
- [ ] **A separate `/inventar/suche` route** — splits the inventory experience; extra nav for little gain.
- [ ] **Fold into the catalog page** — conflates global catalog with owned inventory; violates the Roadmap separation.

##### Q11. Do we need a new index?
- [x] **No required index; optionally add a composite `(user_id, catalog_card_id, collection_id)` if measured slow** — (Recommended) wxy4/f785 indexes likely suffice at Phase-1 scale; keep it additive and optional.
- [ ] **Mandate a new index now** — premature optimization without measurement.

##### Q12. New ADR needed?
- [x] **No** — (Recommended) read-only aggregating query over already-ADR'd schemas; no new persistence/auth/dependency/cross-cutting pattern; any index additive.
- [ ] **Yes** — nothing structural changes; would be noise and risks contradicting wxy4's ADR.

| Q | Choice |
|---|--------|
| Q10 | Extend inventar.vue |
| Q11 | No required index (optional composite) |
| Q12 | No ADR |

</details>

_Plan promoted by orchestrator on behalf of the user, 2026-07-04._
