---
# yugioh-alpha-23wn
title: Global card catalog with YGOPRODeck import
status: in-progress
type: feature
priority: normal
tags:
    - area:catalog
    - area:infra
    - effort:large
    - needs-qa
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:57:24Z
parent: yugioh-alpha-brmu
---

## Problem

The app has no card data at all — server/db/schema.ts contains only auth tables. Phase 1 needs a global card catalog as the canonical reference that user-owned cards will point to. Catalog cards are global reference data, not owned cards (key product principle in docs/Roadmap.md).

The catalog must represent: card name, card type, attributes and properties, effects/text, sets and printings, release information, artwork/images.

## Proposed Solution

- Drizzle tables for catalog cards and their sets/printings, designed so later phases (inventory references, rule formats based on card data like release date/attribute/set) don't require reshaping.
- Idempotent import/sync from the YGOPRODeck API (server task, endpoint, or script) that upserts the full card database.
- Image strategy: YGOPRODeck discourages hotlinking; README lists an image proxy/cache as follow-up work. MVP may store image URLs — planner to decide.

## Effort

Large

<!-- routine:plan -->
## Plan

> Add the canonical global card catalog: normalized Drizzle tables for cards, sets, printings and images, plus an idempotent upsert import from the YGOPRODeck v7 `cardinfo` API (server task + guarded admin endpoint), storing remote image URLs now with a local image cache deferred.

### 1. Overview

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Catalog identity / primary key | Use YGOPRODeck `id` (passcode) as `catalog_card.id` (integer PK) |
| Q2 | Schema shape | Normalized: `catalog_card` + `catalog_set` + `catalog_printing` (join w/ rarity) + `catalog_card_image` |
| Q3 | Monster-specific fields | Flat nullable columns on `catalog_card` (atk/def/level/attribute/race/linkval/scale…) |
| Q4 | Variable extras (linkmarkers, prices, banlist, formats) | JSON text columns via Drizzle `{ mode: 'json' }` |
| Q5 | Release date | Store `tcg_date`/`ocg_date` (import with `misc=yes`) as text ISO dates, indexed for later format rules |
| Q6 | Image strategy (MVP) | Store remote URLs (`image_url`, `image_url_small`, `image_url_cropped`); local proxy/cache deferred to follow-up bean |
| Q7 | Import mechanism | Nitro server task `catalog:sync` (scheduled-capable) + POST `/api/admin/catalog/sync` guarded to first-user; a full-DB fetch, chunked upsert |
| Q8 | Idempotency | `INSERT … ON CONFLICT DO UPDATE` (upsert) keyed on stable IDs; wrapped in a transaction per chunk; `catalog_sync` run-log table |
| Q9 | Rate limiting / fetch | Single full-database GET (0 params) + `misc=yes`; respect 20 req/s (only 1–2 requests total); axios-free `$fetch` |
| Q10 | Migration | New Drizzle migration generated via `db:generate`; applied by existing startup `migrate.ts` plugin |
| Q11 | ADR | New ADR required: "Card catalog data model and YGOPRODeck import" (structural: first domain schema + external data source) |

### 2. Data model

All tables live in `server/db/schema.ts` (same file as auth tables, per existing pattern). SQLite via `drizzle-orm/sqlite-core`. No FK to `user` — catalog is global reference data (Roadmap "Key Product Principle": a catalog card is a global reference card, distinct from owned cards).

#### `catalog_card`

| Field | Type | Notes |
|-------|------|-------|
| `id` | integer PK | YGOPRODeck passcode (`card.id`) — stable canonical key that owned cards will FK to |
| `name` | text notNull | card name |
| `type` | text notNull | e.g. "Effect Monster", "Spell Card" |
| `frame_type` | text | `frameType` |
| `desc` | text notNull | effect / flavor text |
| `race` | text | monster type / spell-trap property (Spellcaster, Continuous…) |
| `archetype` | text | nullable |
| `attribute` | text | DARK/LIGHT/… (monsters only) |
| `atk` | integer | nullable |
| `def` | integer | nullable |
| `level` | integer | level or rank (nullable) |
| `linkval` | integer | link monsters |
| `scale` | integer | pendulum scale |
| `link_markers` | text `{mode:'json'}` | string[] positions |
| `banlist_info` | text `{mode:'json'}` | `{ban_tcg,ban_ocg,ban_goat}` (feeds Phase 4 formats) |
| `card_prices` | text `{mode:'json'}` | latest price snapshot |
| `tcg_date` | text | ISO date, indexed (release-date format rules) |
| `ocg_date` | text | ISO date |
| `ygoprodeck_url` | text | source link |
| `synced_at` | integer `{mode:'timestamp'}` notNull | last upsert time |

Indexes: `idx_catalog_card_name` on `name`, `idx_catalog_card_type` on `type`, `idx_catalog_card_attribute`, `idx_catalog_card_tcg_date`.

#### `catalog_set`

| Field | Type | Notes |
|-------|------|-------|
| `code` | text PK | `set_code` (e.g. LOB-EN001's set prefix); unique set code |
| `name` | text notNull | `set_name` |

> Note: YGOPRODeck's `set_code` in `card_sets` is per-printing (card-in-set). A "set" is identified by `set_name`; multiple printings share a name. Design: `catalog_set` keyed by a slug of `set_name` (`set_name` is the natural key, so use a generated text id = normalized name; store `name`). See §Import for exact derivation.

Revised `catalog_set`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | text PK | slug of `set_name` |
| `name` | text notNull unique | `set_name` |

#### `catalog_printing`

Join between a card and a set with printing-specific data (owned cards later reference a printing for edition/rarity).

| Field | Type | Notes |
|-------|------|-------|
| `id` | text PK | `${set_code}` (per-printing set code, unique across API) |
| `card_id` | integer notNull → `catalog_card.id` cascade | |
| `set_id` | text notNull → `catalog_set.id` cascade | |
| `set_code` | text notNull | full printing code, e.g. `SDY-006` |
| `rarity` | text | `set_rarity` |
| `price` | text | `set_price` (USD string) |

Indexes: `idx_printing_card` on `card_id`, `idx_printing_set` on `set_id`.

#### `catalog_card_image`

| Field | Type | Notes |
|-------|------|-------|
| `id` | integer PK | `card_images[].id` (art variant id) |
| `card_id` | integer notNull → `catalog_card.id` cascade | |
| `image_url` | text notNull | full-size remote URL |
| `image_url_small` | text | thumbnail |
| `image_url_cropped` | text | cropped art |

Index: `idx_image_card` on `card_id`.

#### `catalog_sync` (run log)

| Field | Type | Notes |
|-------|------|-------|
| `id` | integer PK autoincrement | |
| `started_at` | integer timestamp notNull | |
| `finished_at` | integer timestamp | null until complete |
| `status` | text notNull | `running` \| `success` \| `error` |
| `card_count` | integer | upserted cards |
| `error` | text | message on failure |

**Migration:** run `pnpm db:generate` to emit `server/db/migrations/0001_*.sql` + snapshot; the existing `server/plugins/migrate.ts` applies it at startup. No data migration needed (all new tables).

### 3. Import / sync

**Source:** `GET https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes` (0 filter params returns the full DB; `misc=yes` adds `tcg_date`/`ocg_date`). Rate limit 20 req/s — full sync is 1 request, well within limits.

**Modules (new files):**
- `server/utils/ygoprodeck.ts` — typed `fetchAllCards()` using Nitro `$fetch`, response types (`YgoproCard`, `YgoproCardSet`, `YgoproCardImage`, `YgoproMisc`), plus `mapCardToRows()` pure mappers (→ card/set/printing/image row objects) used by both task and tests.
- `server/utils/catalog-sync.ts` — `syncCatalog(db)`: opens a `catalog_sync` row (`running`), fetches, then upserts in chunks (~500 cards/tx) via `db.transaction`, dedupes sets by slug, marks the run `success`/`error`. Idempotent: re-running upserts the same rows (no dupes) and prunes nothing destructively in MVP.
- `server/tasks/catalog/sync.ts` — Nitro task `catalog:sync` wrapping `syncCatalog(useDb())` (enables scheduling later; runnable via `nitro` task runner).
- `server/api/admin/catalog/sync.post.ts` — POST endpoint: require an authenticated session (`useAuth().api.getSession`), 401 if none; kicks `syncCatalog` and returns the run summary. MVP admin gate = any logged-in user (single-user personal app; note in ADR that a real admin role is deferred).

**Upsert (Drizzle):** `db.insert(catalogCard).values(rows).onConflictDoUpdate({ target: catalogCard.id, set: {…} })`. Sets deduped in-memory by slug before insert with `onConflictDoNothing`/`DoUpdate` on `catalog_set.id`. Printings & images upserted on their PKs. `link_markers`/`banlist_info`/`card_prices` serialized via `{mode:'json'}` columns.

**Flow:**
```
catalog:sync task ─┐
POST /admin/…/sync ─┴─► syncCatalog(db)
   1. insert catalog_sync {status:running}
   2. fetchAllCards()           (1 HTTP GET, misc=yes)
   3. for chunk in chunks(cards, 500):
        tx: upsert cards, sets, printings, images
   4. update catalog_sync {status:success, card_count, finished_at}
   (on throw → status:error, error msg; re-raise)
```

**Where import is triggered in dev:** documented in README — run `pnpm nuxt task run catalog:sync` (or POST the endpoint) once after migrations. Not auto-run on startup (a ~13k-card fetch shouldn't block boot).

### 4. Image strategy (MVP)

Store the three remote YGOPRODeck URLs per art variant in `catalog_card_image`. YGOPRODeck forbids sustained hotlinking, but for MVP display volume this is acceptable and matches README's "MVP may store image URLs." A **local image proxy/cache** (download + re-host, e.g. Nitro route caching art under `data/images/` or object storage) is explicitly deferred — a follow-up bean will be created (see Out of scope). ADR records this trade-off so the follow-up doesn't reopen the schema decision (URLs stay; a `local_path` column can be added additively).

### 5. Affected files

New:
- `server/db/schema.ts` (extend) — 5 new tables + indexes + `relations()` exports.
- `server/db/migrations/0001_*.sql` + `meta/` (generated).
- `server/utils/ygoprodeck.ts`, `server/utils/catalog-sync.ts`
- `server/tasks/catalog/sync.ts`
- `server/api/admin/catalog/sync.post.ts`
- `tests/nuxt/catalog-sync.test.ts` (mappers + upsert idempotency)
- `docs/adr/NNNN-card-catalog-data-model.md` (implementer allocates number)

Touched:
- `README.md` — replace the "planned as follow-up" catalog line with actual sync instructions; note image proxy still follow-up.
- `nuxt.config.ts` — only if a `nitro.experimental.tasks`/scheduledTasks flag is needed for the task runner (verify at build; add minimally).

### Dependencies

None new. Uses existing `drizzle-orm`, `better-sqlite3`, Nitro `$fetch`, Nitro tasks, `better-auth`. (Deliberately avoids adding an HTTP client — `$fetch` suffices for 1 request.)

### Docs & ADR impact

- **New ADR required** (structural: introduces the first domain data schema and an external data source). Proposed title: *"Card catalog data model and YGOPRODeck import"*. Records: passcode as canonical PK, normalized card/set/printing/image split, JSON columns for variable arrays, remote-URL image strategy with deferred local cache, upsert-based idempotent sync. Do not allocate the number here.
- `README.md` updated (sync instructions; image proxy remains follow-up).
- No change to `docs/Roadmap.md` (design conforms to it).

### Test plan

| # | Test case | Type | Steps | Expected |
|---|-----------|------|-------|----------|
| 1 | `mapCardToRows` maps a monster card | unit | Feed a fixture YGOPRODeck monster (atk/def/level/attribute/link_markers) | Correct card row + image/printing rows; link_markers serialized |
| 2 | `mapCardToRows` maps a spell/trap (nullable monster fields) | unit | Feed spell fixture | atk/def/level/attribute null; type/race populated |
| 3 | Set dedup | unit | Two cards sharing a `set_name` | One `catalog_set` row, two printings |
| 4 | `syncCatalog` upsert is idempotent | nuxt (in-memory better-sqlite3) | Run mapper output through upsert twice | Row counts identical after 2nd run; no dupes; `synced_at` updated |
| 5 | `syncCatalog` records a success run | nuxt | Run with mocked `fetchAllCards` | `catalog_sync` row `status:success`, `card_count` correct |
| 6 | `syncCatalog` records error on fetch failure | nuxt | Mock `fetchAllCards` to throw | run row `status:error`, error re-raised |
| 7 | Sync endpoint requires auth | nuxt/e2e | POST `/api/admin/catalog/sync` unauthenticated | 401 |
| 8 | Migration applies cleanly | typecheck/build | `db:generate` then startup migrate | Tables exist; `nuxt typecheck` + `build` green |

Done = `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint` green (WORKFLOW §5), with tests for every behavior change. `test:e2e` if the auth-guard e2e (#7) is added there.

### Suggested classification & branch

Tags: `effort:large` (keep), `area:catalog` (keep), add `area:infra` (schema + import task + external API). Branch: `claude/23wn-global-card-catalog`.

### Out of scope

- Card search/filtering UI and API (owned by `yugioh-alpha-82gj`, blocked by this).
- Owned-card / inventory tables and their FK to `catalog_card` (owned by inventory beans).
- Local image proxy/cache (download + re-host) — create a follow-up bean; schema leaves room via additive `local_path`.
- Scheduled/cron auto-sync, incremental delta sync, and price-history tracking (MVP does a full upsert on demand).
- Admin role model (MVP gate = any authenticated user).
- Destructive pruning of cards removed upstream.

<details>
<summary>Brainstorming record (auto-resolved)</summary>

#### Round 1: Data model & identity
##### Q1. What is the primary key for a catalog card?
- [x] **YGOPRODeck `id` (passcode) as integer PK** — (Recommended) stable, globally unique, is what owned cards & printings naturally reference; upsert target.
- [ ] **Surrogate autoincrement + unique passcode** — extra indirection for no gain here.
- [ ] **Card name** — not unique (alt arts, renames); bad key.

##### Q2. How normalized should the schema be?
- [x] **Normalized: card + set + printing + image tables** — (Recommended) matches Roadmap's catalog/printing separation; lets Phase 4 format rules query by set and printings feed owned-card editions.
- [ ] **Single wide table with JSON blobs for sets/images** — simpler now but blocks set-based queries and owned→printing FKs later; violates "don't reshape later."
- [ ] **card + images only, drop sets** — loses set/rarity data the roadmap calls out.

##### Q3. Where do monster-specific stats live?
- [x] **Flat nullable columns on `catalog_card`** — (Recommended) simple querying/filtering/indexing for search & format rules; sparse nulls are cheap in SQLite.
- [ ] **Separate `catalog_monster` table** — join overhead, no clear win for a card app.
- [ ] **All stats in one JSON column** — can't index atk/level/attribute for search.

##### Q4. How to store variable arrays (link markers, prices, banlist)?
- [x] **JSON text columns (`{mode:'json'}`)** — (Recommended) low-cardinality display/rule metadata; avoids table sprawl; Drizzle native.
- [ ] **Dedicated child tables each** — over-engineered for MVP display data.

| Q | Choice |
|---|--------|
| Q1 | Passcode integer PK |
| Q2 | Normalized 4 tables |
| Q3 | Flat nullable columns |
| Q4 | JSON columns |

#### Round 2: External data & import
##### Q5. How to fetch the catalog?
- [x] **Single full-DB GET `cardinfo.php?misc=yes`** — (Recommended) API returns all cards with 0 params; 1 request stays far under the 20 req/s limit; `misc=yes` gives release dates for format rules.
- [ ] **Per-archetype/paged fetch loop** — more requests, more rate-limit risk, no benefit.

##### Q6. What runs the import?
- [x] **Nitro task `catalog:sync` + guarded POST endpoint** — (Recommended) task enables future scheduling and CLI runs; endpoint lets an authed user trigger from the app; both call one `syncCatalog`.
- [ ] **Startup plugin auto-sync** — blocks boot on a ~13k-card fetch; bad DX.
- [ ] **Standalone script only** — not reusable in-app or schedulable.

##### Q7. How is idempotency guaranteed?
- [x] **`onConflictDoUpdate` upsert on stable PKs, chunked in transactions + run log** — (Recommended) re-runs converge, no dupes, partial-failure safe per chunk; `catalog_sync` gives observability.
- [ ] **Truncate + reinsert** — deletes rows owned cards may FK to; unsafe once inventory lands.

##### Q8. Auth gate for the sync endpoint?
- [x] **Any authenticated session (401 otherwise)** — (Recommended) single-user personal app; matches existing Better Auth session pattern; ADR notes admin role deferred.
- [ ] **Open endpoint** — lets anyone trigger a heavy sync; unsafe.
- [ ] **New admin role now** — scope creep for a personal MVP.

| Q | Choice |
|---|--------|
| Q5 | Full-DB GET + misc=yes |
| Q6 | Task + guarded endpoint |
| Q7 | Upsert + run log |
| Q8 | Authenticated-only |

#### Round 3: Images, migration, ADR
##### Q9. Image storage for MVP?
- [x] **Store remote URLs; defer local cache** — (Recommended) matches README's stated MVP; unblocks search/display now; schema stays additive (`local_path` later). Follow-up bean for the proxy.
- [ ] **Download & re-host now** — YGOPRODeck-preferred but large scope (storage, backfill, serving) that would balloon this large bean further.
- [ ] **No images** — roadmap explicitly lists artwork.

##### Q10. Where do the new tables live / how migrate?
- [x] **Extend `server/db/schema.ts`; generate a Drizzle migration; existing startup `migrate.ts` applies it** — (Recommended) follows the shipped pattern exactly.
- [ ] **Separate schema file per domain** — Drizzle needs one schema object; current pattern is single file; splitting is a needless deviation now.

##### Q11. Is a new ADR needed?
- [x] **Yes — new ADR "Card catalog data model and YGOPRODeck import"** — (Recommended) first domain schema + first external data source = structural per WORKFLOW §7.
- [ ] **No ADR** — would leave a cross-cutting decision unrecorded; violates guardrails.

| Q | Choice |
|---|--------|
| Q9 | Remote URLs, cache deferred |
| Q10 | Extend schema.ts + generated migration |
| Q11 | New ADR |

</details>

_Plan promoted by orchestrator on behalf of the user, 2026-07-04._

## Delivery
- Branch: claude/23wn-global-card-catalog
- PR: https://github.com/dinooo13/yugioh-alpha/pull/2

## Progress
_Current step: ready for review — PR marked ready_
- [x] Mark PR ready for review
- [x] Extend `server/db/schema.ts` with catalog_card/catalog_set/catalog_printing/catalog_card_image/catalog_sync tables + indexes
- [x] Generate Drizzle migration (`0001_smart_speedball.sql`)
- [x] `server/utils/ygoprodeck.ts` — typed client + pure mappers (mapCardToRows, slugifySetName)
- [x] `server/utils/catalog-sync.ts` — chunked transactional upsert + catalog_sync run log
- [x] `server/tasks/catalog/sync.ts` Nitro task + `nitro.experimental.tasks` config
- [x] `server/api/admin/catalog/sync.post.ts` guarded endpoint (401 if unauthenticated)
- [x] ADR 0001 (card catalog data model and YGOPRODeck import) + docs/adr/README.md index
- [x] README updated with sync instructions
- [x] Unit tests: mapper (monster, spell, set dedup) + slugify
- [x] Unit tests: syncCatalog idempotency, success run log, error run log/re-raise
- [x] Gates green: pnpm test, pnpm typecheck, pnpm lint, pnpm build
- [x] Draft PR opened
