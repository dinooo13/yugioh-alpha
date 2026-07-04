---
# yugioh-alpha-82gj
title: Card catalog search and filtering
status: todo
type: feature
priority: normal
tags:
    - effort:medium
    - area:catalog
    - area:ui
    - agent-ready
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:40:46Z
parent: yugioh-alpha-brmu
blocked_by:
    - yugioh-alpha-23wn
---

## Problem

Users need to find cards in the global catalog. There is currently no catalog UI at all.

## Proposed Solution

- Server-side catalog search API with pagination: search by card name/text, filter by card type, attribute, monster race/type, level, and set.
- Catalog page: search box, filters, results with card images, and a card detail view showing full card data (text, printings, release info).

## Effort

Medium

Depends on the catalog data model and import (blocked-by relation).

<!-- routine:plan -->
## Plan

> Add the first catalog UI: a German catalog page (`/katalog`) with a search box, faceted filters, paginated image-grid results, and a card detail view, all backed by a read-only server search API that queries the `catalog_*` tables introduced by yugioh-alpha-23wn.

### Dependency assumption (blocked-by yugioh-alpha-23wn)

This bean is **blocked-by yugioh-alpha-23wn** and builds directly on its approved schema (see 23wn `## Plan`). We assume — and this bean must be implemented against — the following, all in `server/db/schema.ts`:

- `catalogCard` — PK `id` (integer YGOPRODeck passcode); columns `name`, `type`, `frame_type`, `desc`, `race`, `archetype`, `attribute`, `atk`, `def`, `level`, `linkval`, `scale`, `link_markers` (json), `banlist_info` (json), `card_prices` (json), `tcg_date`, `ocg_date`, `ygoprodeck_url`, `synced_at`. Indexes on `name`, `type`, `attribute`, `tcg_date`.
- `catalogSet` — PK `id` (text slug of `set_name`), `name` (unique).
- `catalogPrinting` — PK `id` (`set_code`), `card_id` → `catalogCard.id`, `set_id` → `catalogSet.id`, `set_code`, `rarity`, `price`. Indexes on `card_id`, `set_id`.
- `catalogCardImage` — PK `id` (art-variant id), `card_id` → `catalogCard.id`, `image_url`, `image_url_small`, `image_url_cropped`. Index on `card_id`.

This bean adds **no schema changes** and does **not** reshape 23wn's tables — it only reads them (plus, if needed, adds purely additive read-optimizing indexes; see §6). If 23wn's final column/export names differ from the above, the implementer adapts the query layer to the shipped names; the API contract in §2 stays stable. If 23wn has not merged when this is picked up, it stays blocked (do not stub the schema).

### 1. Overview

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Search API surface | Single `GET /api/catalog/cards` (list+filter+paginate) + `GET /api/catalog/cards/[id]` (detail) + `GET /api/catalog/facets` (filter option values) |
| Q2 | Text search matching | SQLite `LIKE '%term%'` (case-insensitive) on `name` for MVP; substring on `desc` behind an opt-in `inText=1` flag; FTS deferred |
| Q3 | Pagination | Offset/limit (`page`, `pageSize=24`, cap 60) returning `{ items, total, page, pageSize }` |
| Q4 | Filters | `type`, `attribute`, `race`, `level` (exact), `setId` (join via `catalog_printing`); multi-value via repeated/CSV params; AND across facets |
| Q5 | Auth on catalog API | Require an authenticated session (consistent with global page auth + 23wn sync endpoint); 401 otherwise |
| Q6 | Result shape | Card summary rows include primary image (`image_url_small`) picked in-query; detail endpoint returns full card + printings + all images |
| Q7 | Page & route | New page `app/pages/katalog.vue` (German UI), nav item "Katalog" added to `app/layouts/default.vue` |
| Q8 | Detail view | Client-side `USlideover`/modal on the same page (query-param `?card=<id>` for deep-link/back-button), not a separate route, for MVP |
| Q9 | Data fetching | `useFetch`/`$fetch` against the API with a debounced reactive query object; server does all filtering/paging (no client-side catalog load) |
| Q10 | Images | Render remote YGOPRODeck URLs directly (per 23wn image decision); `loading="lazy"`; local proxy stays deferred to the 23wn follow-up |
| Q11 | Empty-catalog UX | If `total===0` and no filters active, show a "catalog not yet imported — run sync" hint (links to the sync flow); distinct from "no results for this search" |
| Q12 | ADR | None required — read-only feature on an already-ADR'd schema; new indexes are additive. One-line justification in §Docs. |

### 2. Search API

New server routes under `server/api/catalog/`. All use `useDb()` and Drizzle query builder; all require a session via `useAuth().api.getSession({ headers })` (401 on none), matching the app's auth posture.

#### `GET /api/catalog/cards` — search + filter + paginate

Query params (all optional):

| Param | Type | Meaning |
|-------|------|---------|
| `q` | string | substring match on `catalog_card.name` (case-insensitive `LIKE`) |
| `inText` | `0|1` | when `1`, also match `catalog_card.desc` |
| `type` | string (repeatable/CSV) | exact match on `type` (IN) |
| `attribute` | string (repeatable/CSV) | exact match on `attribute` (IN) |
| `race` | string (repeatable/CSV) | exact match on `race` (IN) |
| `level` | integer (repeatable/CSV) | exact match on `level` (IN) |
| `setId` | string | restrict to cards having a `catalog_printing` in that set |
| `sort` | `name|-name|newest` | default `name` asc; `newest` = `tcg_date` desc nulls last |
| `page` | integer ≥1 | default 1 |
| `pageSize` | integer 1–60 | default 24 |

Behavior: validate/clamp params (Zod-free manual coercion, matching the repo's current no-Zod stack; add Zod only if the implementer finds it already pulled in). Build a `where` from present filters (AND). `setId` implemented as `EXISTS`/`inArray` subquery over `catalog_printing.card_id`. Run a `count()` for `total` and a paged select for `items`. Each item: `id, name, type, frameType, attribute, race, level, atk, def, imageSmall` where `imageSmall` = the image row for that card with the lowest `catalog_card_image.id` (the base art), selected via a correlated subquery or a grouped join.

Response:
```json
{ "items": [ { "id": 89631139, "name": "Blue-Eyes White Dragon", "type": "Normal Monster", "attribute": "LIGHT", "race": "Dragon", "level": 8, "atk": 3000, "def": 2500, "imageSmall": "https://images.ygoprodeck.com/.../89631139.jpg" } ],
  "total": 1, "page": 1, "pageSize": 24 }
```

#### `GET /api/catalog/cards/[id]` — detail

Returns the full `catalog_card` row (with parsed `link_markers`, `banlist_info`, `card_prices` — already JSON via `{mode:'json'}`), plus its `printings` (joined with `catalog_set.name`) and all `images`. 404 if not found.

```json
{ "card": { ...full row... },
  "printings": [ { "setCode": "LOB-EN001", "setName": "Legend of Blue Eyes White Dragon", "rarity": "Ultra Rare", "price": "..." } ],
  "images": [ { "id": 89631139, "imageUrl": "...", "imageUrlSmall": "...", "imageUrlCropped": "..." } ] }
```

#### `GET /api/catalog/facets` — filter option values

Returns distinct values to populate the filter selects, so the UI never hard-codes them:
```json
{ "types": ["Effect Monster", "Spell Card", ...],
  "attributes": ["DARK","LIGHT",...],
  "races": ["Dragon","Spellcaster",...],
  "levels": [1,2,...,12],
  "sets": [ { "id": "legend-of-blue-eyes-white-dragon", "name": "Legend of Blue Eyes White Dragon" } ] }
```
`SELECT DISTINCT` per column (indexed on `type`/`attribute`); `sets` from `catalog_set` ordered by `name`. Result cached in-memory per process with a short TTL (facets change only on sync) — optional, note as nice-to-have.

**Affected files (new):**
- `server/api/catalog/cards/index.get.ts`
- `server/api/catalog/cards/[id].get.ts`
- `server/api/catalog/facets.get.ts`
- `server/utils/catalog-query.ts` — pure query-builder helpers: `parseCardListQuery(rawQuery)` (coerce/clamp → typed filter object) and `buildCardListWhere(filters)` (returns Drizzle conditions). Extracted so it is unit-testable without HTTP.
- `server/utils/require-session.ts` — small helper `requireSession(event)` returning the session or throwing `createError({ statusCode: 401 })`; reused by the three routes (and available to future protected APIs). If 23wn already added an equivalent guard for its sync endpoint, reuse that instead of duplicating.

### 3. Catalog page UI

New page `app/pages/katalog.vue`, German copy, using Nuxt UI 4 components (`UInput`, `USelectMenu`, `UButton`, `UCard`, `UPagination`, `USlideover`, `USkeleton`, `UBadge`). Auth is already enforced by `app/middleware/auth.global.ts` (any path not in `PUBLIC_PAGES`).

Wireframe:
```
+--------------------------------------------------------------+
| Katalog                                                      |
| [ 🔎 Karten suchen…            ] [Typ ▾][Attribut ▾][Level ▾] |
|                                          [Set ▾] [Zurücksetzen]|
+--------------------------------------------------------------+
| 1.248 Karten                                     Sort: Name ▾ |
| +------+ +------+ +------+ +------+ +------+ +------+          |
| | img  | | img  | | img  | | img  | | img  | | img  |  (grid) |
| | Name | | Name | | Name | | Name | | Name | | Name |         |
| +------+ +------+ +------+ +------+ +------+ +------+          |
|              ...                                              |
|                     [ ‹ 1 2 3 … › ]  (UPagination)           |
+--------------------------------------------------------------+

Click a card ─▶ USlideover (?card=<id>):
   [ large image ]  Name
                    Typ · Attribut · Level · ATK/DEF
                    ────────────────────────────────
                    Kartentext (desc)
                    Printings (Set · Rarity · Code)
                    Release: tcg_date
```

Behavior:
- Reactive `query` ref `{ q, type[], attribute[], level[], setId, sort, page }`. `q` debounced (~300 ms). Any filter change resets `page` to 1.
- `useFetch('/api/catalog/cards', { query })` (Nuxt auto-reruns on query change); loading → skeleton grid; error → `UAlert`.
- Filter options loaded once via `useFetch('/api/catalog/facets')`.
- Clicking a card sets `?card=<id>` (via `router.replace`) and opens `USlideover`, which lazily `$fetch`es `/api/catalog/cards/[id]`. Closing clears the query param. Deep-linking to `?card=<id>` opens it on load (back/forward works).
- Empty states (Q11): distinguish "catalog not yet imported" (no filters + total 0 → hint to run sync) from "no results" (filters active + total 0).

**Affected files:**
- New: `app/pages/katalog.vue`
- New (optional, if extracted): `app/components/catalog/CardGridItem.vue`, `app/components/catalog/CardDetail.vue`, `app/components/catalog/CatalogFilters.vue` — split only if `katalog.vue` grows unwieldy; MVP may keep them inline.
- Touched: `app/layouts/default.vue` — add nav item `{ label: 'Katalog', icon: 'i-lucide-book-open', to: '/katalog' }` to `navItems` (place after Dashboard, before Inventar, since inventory builds on the catalog).

### 4. Data flow

```
katalog.vue (query ref)
   │  useFetch (debounced)
   ▼
GET /api/catalog/cards ──► requireSession ──► parseCardListQuery
                                              buildCardListWhere
                                              useDb() count + paged select
                                              (correlated primary image)
   ◄── { items, total, page, pageSize }
   │
   ├─ facets: GET /api/catalog/facets (once)
   └─ card click → ?card=id → GET /api/catalog/cards/[id] → USlideover
```

### 5. Business logic & edge cases

- `pageSize`/`page` coerced and clamped server-side; invalid → defaults (never 500).
- `level` filter parses ints; non-numeric ignored.
- Multi-value facets: repeated params and CSV both accepted; empty → no constraint.
- `q` escapes `%` and `_` for `LIKE` so user input can't act as wildcards; case-insensitive (SQLite `LIKE` is ASCII-case-insensitive by default; sufficient for English card names).
- `imageSmall` may be null for a card lacking image rows → UI shows a placeholder tile.
- Cards with no printings still appear in search (image/name/type come from `catalog_card`); `setId` filter simply excludes them.
- Detail 404 → slideover shows a "Karte nicht gefunden" state and clears the query param.

### 6. Schema / index impact (additive only)

No table shape changes. 23wn already indexes `name`, `type`, `attribute`, `tcg_date`. This bean **may additively add** (via a new generated migration, if the implementer measures a need) an index on `catalog_card.level` and `catalog_card.race` to keep facet filtering fast on ~13k rows. This is additive and does **not** reopen the 23wn ADR. If added, generate with `pnpm db:generate`; the startup `server/plugins/migrate.ts` applies it. Given ~13k rows, full-scan filtering may be acceptable for MVP — treat these indexes as optional and add only if the query is slow.

### Dependencies

None new. Uses existing `drizzle-orm`, `better-sqlite3`, `better-auth`, Nuxt UI 4, Nuxt `useFetch`/`$fetch`, Vitest, Playwright. (No search engine, no client-side data lib.)

### Docs & ADR impact

- **No new ADR required.** This is a read-only feature over the schema and external-data decisions already recorded by the 23wn ADR ("Card catalog data model and YGOPRODeck import"); it introduces no new persistence, auth, dependency, or cross-cutting pattern. Any added indexes are additive to an ADR'd schema. Justification recorded here per WORKFLOW §7.
- `README.md`: add a short "Catalog search" note (page `/katalog`, requires a completed sync) once shipped — minor, optional.
- No `docs/Roadmap.md` change (this is Phase 1 "card search and filtering", already scoped there).

### Test plan

| # | Test case | Type (unit/e2e) | Steps | Expected |
|---|-----------|------|-------|----------|
| 1 | `parseCardListQuery` clamps paging | unit | Pass `page=0`,`pageSize=999`,`level=abc` | `page=1`, `pageSize=60` cap, `level` dropped |
| 2 | `parseCardListQuery` parses multi-value facets | unit | `type=A,B`, repeated `attribute` | arrays `['A','B']`, both attributes |
| 3 | `buildCardListWhere` escapes LIKE wildcards | unit | `q="50%_off"` | `%` and `_` escaped; term wrapped in `%...%` |
| 4 | `GET /api/catalog/cards` filters + paginates | nuxt (in-memory better-sqlite3, seeded catalog rows) | Seed 30 cards; request `type=Spell Card&pageSize=10&page=2` | Only spells; ≤10 items; correct `total`/`page` |
| 5 | `GET /api/catalog/cards` name search | nuxt | Seed "Blue-Eyes…"; `q=blue` | Matches case-insensitively; non-matches excluded |
| 6 | `setId` filter via printing join | nuxt | Seed 2 cards, 1 with a printing in set X | `setId=X` returns only that card |
| 7 | `GET /api/catalog/cards/[id]` detail | nuxt | Seed card + 2 printings + 2 images | Returns full card, printings w/ set name, all images |
| 8 | detail 404 | nuxt | Request unknown id | 404 |
| 9 | catalog API requires auth | nuxt/e2e | Request `/api/catalog/cards` unauthenticated | 401 |
| 10 | `GET /api/catalog/facets` distinct values | nuxt | Seed varied cards/sets | Distinct types/attributes/levels + sets list |
| 11 | katalog page renders + shows results | nuxt (`mountSuspended`, mocked fetch) | Mount `katalog.vue` with stubbed `/api/catalog/*` | Renders German "Katalog", search input, and result tiles |
| 12 | catalog page reachable when authed | e2e | Log in, visit `/katalog` | Page loads, nav shows "Katalog" |

Done = the project's verification gates green (WORKFLOW §5): `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` (and `pnpm test:e2e` for the auth-guard/e2e cases), with tests for every behavior change.

### Suggested classification & branch

Tags: `effort:medium` (keep — API + one page, read-only), `area:catalog` (keep), `area:ui` (keep). No new tags needed. Branch: `claude/82gj-card-catalog-search`.

### Out of scope

- Adding cards to inventory / any owned-card write actions from the catalog (owned by inventory beans; catalog is read-only here).
- Full-text search / fuzzy ranking / relevance scoring (MVP is substring `LIKE`); revisit with SQLite FTS5 if needed.
- Advanced filters (atk/def ranges, archetype, banlist status, pendulum/link specifics) — MVP ships name + type/attribute/race/level/set; note as follow-up.
- Local image proxy/cache (deferred by 23wn; a follow-up bean owns it).
- Infinite scroll / virtualized grid (offset pagination for MVP).
- A dedicated `/katalog/[id]` route (MVP uses a slideover with `?card=` deep-link).
- Triggering/scheduling the catalog sync (owned by 23wn); this bean only reads whatever the sync produced.

<details>
<summary>Brainstorming record (auto-resolved)</summary>

#### Round 1: API surface & querying
##### Q1. How many endpoints and what shape?
- [x] **Three: `/cards` (list), `/cards/[id]` (detail), `/facets` (options)** — (Recommended) clean separation; list stays lean, detail returns heavy joins only when opened, facets keep the UI from hard-coding filter values.
- [ ] **One mega-endpoint returning cards + facets** — couples concerns, refetches facets on every search.
- [ ] **List + detail only, hard-code filter options in UI** — filter values drift from actual data; brittle.

##### Q2. Text search matching strategy?
- [x] **`LIKE '%term%'` on name (opt-in on desc)** — (Recommended) zero new deps, indexed-ish, fine for ~13k cards and English names; matches the existing no-search-engine stack.
- [ ] **SQLite FTS5 virtual table** — better ranking but adds schema + sync complexity; premature for MVP substring search.
- [ ] **Load all cards client-side and filter in JS** — ~13k rows over the wire each load; wasteful, breaks pagination story.

##### Q3. Pagination model?
- [x] **Offset/limit with `total`** — (Recommended) simplest, supports a page-number UI (`UPagination`), fine at this scale.
- [ ] **Cursor/keyset** — better for huge/infinite lists; unnecessary complexity for a bounded catalog with page numbers.

##### Q4. Which filters ship in MVP?
- [x] **type, attribute, race, level, set** — (Recommended) exactly the bean's stated filters; all map to indexed/simple columns or a printing join.
- [ ] **Add atk/def ranges, archetype, banlist now** — scope creep beyond the bean; defer.
- [ ] **Name search only** — under-delivers the bean's explicit filter list.

| Q | Choice |
|---|--------|
| Q1 | Three endpoints |
| Q2 | LIKE substring |
| Q3 | Offset/limit |
| Q4 | type/attribute/race/level/set |

#### Round 2: Auth, result shape, images
##### Q5. Auth on the catalog API?
- [x] **Require an authenticated session (401 otherwise)** — (Recommended) whole app is auth-gated (`auth.global.ts`) and 23wn's sync endpoint is authed; keeps posture consistent for a personal app.
- [ ] **Public catalog API** — inconsistent with the gated app; no benefit for a single-user MVP.

##### Q6. What does a search result row contain?
- [x] **Lean summary + one primary image; full data only in detail** — (Recommended) fast grid payloads; heavy printings/images fetched on demand when a card opens.
- [ ] **Full card + all images per row** — bloats list responses (multiple arts/printings per card).

##### Q10. How are images rendered?
- [x] **Remote YGOPRODeck URLs directly, lazy-loaded** — (Recommended) consistent with 23wn's stored-URL decision; no proxy yet.
- [ ] **Wait for/ build a local proxy** — 23wn explicitly deferred this; would block search on unrelated work.

##### Q11. Empty-catalog UX?
- [x] **Distinguish "not imported" vs "no results"** — (Recommended) avoids a confusing blank grid before the first sync; guides the user to run sync.
- [ ] **Single generic empty state** — ambiguous before import.

| Q | Choice |
|---|--------|
| Q5 | Authenticated-only |
| Q6 | Lean row + primary image |
| Q10 | Remote URLs |
| Q11 | Two distinct empty states |

#### Round 3: UI structure & detail view
##### Q7. Where does the catalog live in the app?
- [x] **New `/katalog` page + nav item, German copy** — (Recommended) matches the German UI (`lang: de`, existing pages) and the roadmap's catalog concept; nav currently lacks any catalog entry.
- [ ] **Fold search into `/inventar`** — conflates catalog (global) with inventory (owned); violates the Roadmap's key separation principle.

##### Q8. How is card detail presented?
- [x] **Slideover on the same page with `?card=<id>` deep-link** — (Recommended) keeps search state, back-button works, no full page nav; good UX for browsing.
- [ ] **Dedicated `/katalog/[id]` route** — heavier nav, loses scroll/filter state on back; defer.
- [ ] **Inline expand in grid** — awkward for the amount of detail (text + printings + images).

##### Q9. Where does filtering/paging happen?
- [x] **Entirely server-side; UI sends a query object** — (Recommended) scales to the full catalog, small payloads, single source of truth in SQL.
- [ ] **Client-side filtering** — requires shipping the whole catalog; rejected in Q2.

##### Q12. New ADR needed?
- [x] **No** — (Recommended) read-only feature on an already-ADR'd schema (23wn); no new persistence/auth/dependency/cross-cutting pattern; any index is additive.
- [ ] **Yes** — nothing structural changes; would be noise.

| Q | Choice |
|---|--------|
| Q7 | New /katalog page |
| Q8 | Slideover + deep-link |
| Q9 | Server-side filtering |
| Q12 | No ADR |

</details>

_Plan promoted by orchestrator on behalf of the user, 2026-07-04._
