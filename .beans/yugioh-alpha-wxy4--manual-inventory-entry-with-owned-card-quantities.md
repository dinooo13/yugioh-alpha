---
# yugioh-alpha-wxy4
title: Manual inventory entry with owned card quantities
status: todo
type: feature
priority: normal
tags:
    - area:ui
    - agent-ready
    - effort:large
    - area:inventory
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:40:46Z
parent: yugioh-alpha-brmu
blocked_by:
    - yugioh-alpha-23wn
---

## Problem

Users cannot record which cards they own. The inventory page (app/pages/inventar.vue) is a placeholder. Phase 1 needs manual inventory entry: an owned card references a catalog card and carries ownership-specific data — quantity, language, condition, edition/printing (collection/storage assignment is a separate bean).

## Proposed Solution

- owned_card table: user id + catalog card reference + quantity, language, condition, edition/printing.
- Add-to-inventory flow from catalog search (pick a card, set quantity and ownership details).
- Inventory page listing the user's owned cards with edit (quantity/details) and remove.
- Strictly per-user ownership boundaries.

## Effort

Large

Depends on the catalog data model and import (blocked-by relation).

<!-- routine:plan -->
## Plan

> Add manual inventory entry: an `owned_card` table (per-user, referencing `catalog_card`) plus an "add to inventory" flow from catalog search and an inventory page to list/edit/remove owned cards — building the Phase 1 personal-inventory core on top of the catalog schema from yugioh-alpha-23wn.

### Dependency assumptions (blocked-by yugioh-alpha-23wn)

This plan is written **against 23wn's approved catalog schema** and assumes it lands first:

- `catalog_card.id` = **integer** primary key (YGOPRODeck passcode). `owned_card.catalog_card_id` FKs to it (`integer`, `references(() => catalogCard.id)`).
- `catalog_printing.id` = **text** PK (per-printing `set_code`, e.g. `SDY-006`). Owned cards may optionally reference a printing for edition/rarity via `owned_card.printing_id` (`text`, nullable, `references(() => catalogPrinting.id)`).
- `catalog_card_image` / `catalog_set` exist for display joins (image + set name in the inventory list).
- Tables live in `server/db/schema.ts`; migrations generated with `pnpm db:generate` and applied by `server/plugins/migrate.ts` at startup.
- The catalog will actually be populated (23wn's `catalog:sync`). If empty at runtime, catalog search returns nothing and the add flow simply has no cards to add — no code change needed.

If 23wn's final schema deviates (e.g. surrogate catalog PK, different printing key type), the implementer adjusts the two FK column types/targets accordingly; nothing else in this plan changes structurally.

### 1. Overview

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Owned-card grain (identity) | One `owned_card` row per (user, catalog_card, printing, language, condition, edition) tuple, carrying a `quantity` count — not one row per physical copy |
| Q2 | Owned-card PK | Surrogate `text` UUID `id` (matches `user.id` text-id convention); `(user_id, catalog_card_id, printing_id, language, condition, edition)` uniqueness enforced by app-level upsert, not a DB unique index (NULLs in unique keys are unreliable in SQLite) |
| Q3 | Ownership boundary | `user_id` notNull FK → `user.id` cascade; every query filters by the session user; no cross-user reads |
| Q4 | Printing/edition/language/condition modeling | `printing_id` optional FK (text) + free-ish enumerated `language`, `condition`, `edition` text columns with app-validated allowed sets; sensible defaults |
| Q5 | Session access server-side | New `server/utils/session.ts` helper `requireUser(event)` calling `useAuth().api.getSession({ headers })`; 401 if none — first server-side auth util |
| Q6 | Add-to-inventory entry point | Reuse the catalog search UI (82gj) with an "Add" action per result opening a modal (quantity + details); inventory page also links to catalog to add |
| Q7 | Inventory list data | New `GET /api/inventory` returns owned rows joined to catalog (name, type, image, set) — server does the join so the client stays thin |
| Q8 | Edit/remove | `PATCH /api/inventory/:id` (quantity + editable details), `DELETE /api/inventory/:id`; quantity 0 via PATCH is rejected (use DELETE to remove) |
| Q9 | Validation | Shared Zod-free hand-rolled validators in `server/utils/inventory.ts` (allowed language/condition/edition, quantity >= 1, catalog_card_id exists); no new dep |
| Q10 | ADR | New ADR required: "Owned-card (inventory) data model" (structural: first user-owned domain schema + ownership-boundary pattern) |
| Q11 | Coupling to 82gj (catalog search) | Depend on 82gj's search API for the add flow; if 82gj isn't merged yet, ship a minimal name-search fallback inside this bean's scope guarded so we don't block — see §6 |

### 2. Data model

New table in `server/db/schema.ts` (same file, per existing pattern), SQLite via `drizzle-orm/sqlite-core`.

#### `owned_card`

| Field | Type | Notes |
|-------|------|-------|
| `id` | text PK | UUID (generated with `crypto.randomUUID()`), matches `user.id` text convention |
| `user_id` | text notNull → `user.id` cascade | ownership boundary; indexed |
| `catalog_card_id` | integer notNull → `catalog_card.id` | canonical card reference (23wn passcode PK); indexed |
| `printing_id` | text → `catalog_printing.id` set null | optional specific printing (edition/rarity/set); nullable |
| `quantity` | integer notNull default 1 | copies owned (>= 1) |
| `language` | text notNull default `'en'` | enumerated: en, de, fr, it, es, pt, ja, ko |
| `condition` | text notNull default `'near_mint'` | enumerated: mint, near_mint, excellent, good, light_played, played, poor |
| `edition` | text notNull default `'unlimited'` | enumerated: first, unlimited, limited |
| `note` | text | optional freeform user note |
| `created_at` | integer `{mode:'timestamp'}` notNull | |
| `updated_at` | integer `{mode:'timestamp'}` notNull | |

Indexes: `idx_owned_card_user` on `user_id`, `idx_owned_card_user_card` on `(user_id, catalog_card_id)` (list + dedupe lookups).

`relations()`: `owned_card` belongsTo `user`, `catalog_card`, and (optional) `catalog_printing`.

**Grain rationale (Q1/Q2):** a stack of identical copies is one row with a `quantity`, but copies that differ in printing/language/condition/edition are distinct rows — this maps to how collectors think ("3× LOB 1st-ed near-mint EN") and keeps deck-availability checks (Phase 3) a simple `SUM(quantity)` per `catalog_card_id`. On add, the server looks up an existing row matching the full tuple and increments `quantity` instead of inserting a duplicate (app-level upsert; §3).

**Migration:** `pnpm db:generate` emits `server/db/migrations/000X_*.sql` + snapshot; `server/plugins/migrate.ts` applies it at startup. All-new table, no data migration. Ordering: this migration must be generated **after** 23wn's catalog migration so the `catalog_card`/`catalog_printing` tables the FKs reference already exist.

### 3. Server API

All handlers resolve the session user first via a new helper and scope every query to that user.

**New `server/utils/session.ts`:**
```
requireUser(event): Promise<{ id: string }>
  → const session = await useAuth().api.getSession({ headers: event.headers })
  → if (!session?.user) throw createError({ statusCode: 401 })
  → return session.user
```
(First server-side session util; mirrors the client `getAuthSession` but server-side via Better Auth's `api.getSession`.)

**New `server/utils/inventory.ts`:** allowed-value constants (`LANGUAGES`, `CONDITIONS`, `EDITIONS`), `validateInventoryInput(body)` (pure; returns normalized fields or throws 400), `findOrCreateOwnedCard` / upsert-by-tuple logic, and the catalog-join select builder — all pure/DB helpers reused by handlers and tests.

**Endpoints:**

| Method | Route (new file) | Behavior |
|--------|------------------|----------|
| `GET` | `server/api/inventory/index.get.ts` | List current user's owned cards joined to `catalog_card` (name, type, image_url_small) + `catalog_set` name; supports `?q=` name filter and pagination (`?page`,`?pageSize`); returns `{ items, total }` |
| `POST` | `server/api/inventory/index.post.ts` | Add: validate body (`catalog_card_id` required + must exist in catalog, optional `printing_id`/language/condition/edition/quantity/note); upsert-by-tuple (increment quantity if match, else insert); 201 with the row |
| `PATCH` | `server/api/inventory/[id].patch.ts` | Update quantity/details of the user's own row; 404 if not owned; reject `quantity < 1` (400 — use DELETE); re-dedupe if edited fields collide with another existing tuple (merge quantities) |
| `DELETE` | `server/api/inventory/[id].delete.ts` | Remove the user's own row; 404 if not owned; 204 |

Every handler calls `requireUser(event)` and adds `eq(ownedCard.userId, user.id)` to reads/writes. Add/patch verify `catalog_card_id` exists (`select` count) to keep FK integrity friendly and return a clean 400 rather than a raw FK error.

**Flow (add):**
```
POST /api/inventory ─► requireUser ─► validateInventoryInput
  ─► ensure catalog_card_id exists (else 400)
  ─► find owned_card row matching (user, card, printing, lang, cond, edition)
        exists?  → UPDATE quantity += qty, updated_at
        none?    → INSERT new row (uuid)
  ─► return row (201)
```

### 4. UI

**Inventory page — `app/pages/inventar.vue`** (replace placeholder):

```
┌───────────────────────────────────────────────────────────────┐
│  Inventar                              [ + Karte hinzufügen ]   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [ Suche im Inventar…            ]                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌────┬───────────────────────┬──────┬─────────┬──────┬─────┐  │
│  │img │ Blue-Eyes White Dragon│ EN   │ 1st ed  │ NM   │ ×3  │  │
│  │    │ Normal Monster · LOB  │      │         │      │[✎][🗑]│ │
│  ├────┼───────────────────────┼──────┼─────────┼──────┼─────┤  │
│  │ …  │                       │      │         │      │     │  │
│  └────┴───────────────────────┴──────┴─────────┴──────┴─────┘  │
│                                     ‹ 1 2 3 ›   (Pagination)    │
└───────────────────────────────────────────────────────────────┘
```
- Uses Nuxt UI (`UTable`/`UCard`, `UButton`, `UInput`, `UModal`, `UPagination`, `USelect`) consistent with existing pages/layout.
- Empty state: message + "Karte hinzufügen" CTA linking to catalog search.
- `useFetch('/api/inventory', ...)` for the list (SSR-friendly, cookie-forwarded like the layout does).
- Edit (`✎`) opens the same modal as add, pre-filled; remove (`🗑`) confirms then `DELETE`.

**Add-to-inventory modal — `app/components/inventory/AddToInventoryModal.vue`** (new):
- Fields: quantity (number, min 1), language / condition / edition (`USelect` from allowed sets), optional printing (`USelect` of the card's `catalog_printing` rows), note.
- Given a `catalogCardId` prop; POSTs to `/api/inventory`; emits saved.

**Catalog search integration (from 82gj):**
- The catalog search results (82gj) get an "Add" action per card that opens `AddToInventoryModal`. Since 82gj is a separate bean, this bean **owns the modal component and the API**; wiring the button into 82gj's result rows is a small hook 82gj's plan can consume. To stay independently shippable, `inventar.vue` includes its own "Karte hinzufügen" button that opens a lightweight catalog name-search picker (see §6) feeding the same modal.

### 5. Affected files

New:
- `server/db/schema.ts` (extend) — `owned_card` table + indexes + relations.
- `server/db/migrations/000X_*.sql` + `meta/` (generated).
- `server/utils/session.ts` — `requireUser(event)`.
- `server/utils/inventory.ts` — validators, allowed-value constants, upsert + join helpers.
- `server/api/inventory/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`.
- `app/components/inventory/AddToInventoryModal.vue`.
- `app/components/inventory/CatalogCardPicker.vue` (minimal name-search picker fallback, §6).
- `tests/nuxt/inventory-api.test.ts` (handlers/validators/upsert idempotency + ownership boundary).
- `tests/nuxt/inventar-page.test.ts` (page renders list + empty state).
- `docs/adr/NNNN-owned-card-inventory-data-model.md` (implementer allocates number).

Touched:
- `app/pages/inventar.vue` — replace placeholder with the real inventory view.

### Dependencies

None new. Uses `drizzle-orm`, `better-sqlite3`, Nitro `$fetch`/`useFetch`, `better-auth` (`api.getSession`), `@nuxt/ui`, `crypto.randomUUID()`. Validation is hand-rolled (no Zod) to match the existing dependency-light server code.

### Docs & ADR impact

- **New ADR required** (structural: first user-owned domain schema + the per-user ownership-boundary pattern and the owned-card grain). Proposed title: *"Owned-card (inventory) data model"*. Records: owned_card references `catalog_card` (never duplicates catalog data), quantity-stacked grain keyed by (user, card, printing, language, condition, edition), surrogate UUID PK, `requireUser` server-side auth gate, and app-level upsert (no partial-null unique index). Do not allocate the number here.
- No change to `docs/Roadmap.md` (design conforms to the "owned card references a catalog card" principle).
- `README.md`: add a one-line note that inventory entry is available (optional; verify at build).

### Test plan

| # | Test case | Type | Steps | Expected |
|---|-----------|------|-------|----------|
| 1 | `validateInventoryInput` accepts valid body | unit | Feed valid add body | Normalized fields; defaults applied (language en, condition near_mint, edition unlimited, quantity 1) |
| 2 | `validateInventoryInput` rejects bad values | unit | quantity 0 / unknown language / missing catalog_card_id | Throws 400 |
| 3 | POST adds a new owned card | nuxt (in-memory better-sqlite3, seeded catalog) | Auth'd POST valid body | 201; one `owned_card` row scoped to user |
| 4 | POST upsert increments quantity | nuxt | POST same tuple twice (qty 1 each) | One row, quantity 2 (no duplicate) |
| 5 | POST rejects unknown catalog_card_id | nuxt | POST card id not in catalog | 400 |
| 6 | GET lists only current user's cards | nuxt | Seed rows for user A and B; GET as A | Only A's rows returned, joined with catalog name/image |
| 7 | PATCH updates quantity/details of own row | nuxt | Auth'd PATCH own row | Row updated; quantity < 1 → 400 |
| 8 | PATCH/DELETE on another user's row | nuxt | Auth'd as B, target A's row | 404 (ownership boundary) |
| 9 | DELETE removes own row | nuxt | Auth'd DELETE own row | 204; row gone |
| 10 | Unauthenticated requests rejected | nuxt/e2e | Call each endpoint with no session | 401 |
| 11 | Inventory page renders list + empty state | nuxt | Mount `inventar.vue` with mocked fetch (rows / empty) | Rows shown; empty-state CTA when none |

Done = `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint` green (WORKFLOW §5), with tests for every behavior change. Add the auth-guard (#10) to `test:e2e` if a session-backed e2e harness is available; otherwise cover via the nuxt runtime test.

### Suggested classification & branch

Tags: `effort:large` (keep — new schema + 4 endpoints + auth util + page + modal + ADR), `area:inventory` (keep), add `area:ui` (inventory page + modal). Branch: `claude/wxy4-manual-inventory-entry`.

### Out of scope

- Collections / storage-location assignment — owned by `yugioh-alpha-f785` (blocked by this).
- Catalog search UI/API itself — owned by `yugioh-alpha-82gj`; this bean provides only the add-to-inventory modal + API and a minimal picker fallback.
- Photo/OCR/bulk/voice entry (Phase 2).
- Deck-availability checks against owned quantities (Phase 3 deckbuilder).
- Price/value tracking of the collection.
- Cross-user sharing / visibility (Phase 6).

<details>
<summary>Brainstorming record (auto-resolved)</summary>

#### Round 1: Data model & grain
##### Q1. What is the grain of an owned_card row?
- [x] **Quantity-stacked by attribute tuple** — (Recommended) one row per (user, card, printing, language, condition, edition) with a `quantity`; matches collector mental model and makes Phase 3 availability a simple SUM.
- [ ] **One row per physical copy** — huge row counts, no real benefit for a catalog-driven app.
- [ ] **One row per (user, card) with details in JSON** — can't query/filter by condition/edition; blocks deck checks.

##### Q2. Owned-card primary key?
- [x] **Surrogate text UUID** — (Recommended) matches `user.id` text-id convention; stable target for PATCH/DELETE and future FKs (deck cards).
- [ ] **Composite natural key (user+card+printing+lang+cond+edition)** — unwieldy for URLs/PATCH and unreliable with nullable printing in SQLite unique indexes.
- [ ] **Autoincrement integer** — deviates from the app's text-id convention.

##### Q3. How is the per-user ownership boundary enforced?
- [x] **`user_id` notNull FK + every query filtered by session user** — (Recommended) simple, matches Roadmap "strictly per-user"; 404 on other users' rows.
- [ ] **Row-level DB policy** — SQLite/Drizzle has no RLS; not available.

##### Q4. How to model printing/edition/language/condition?
- [x] **Optional `printing_id` FK + enumerated text columns with app-validated sets + defaults** — (Recommended) queryable, indexable, keeps catalog authority for printing data while allowing "I don't know the exact printing".
- [ ] **Everything in JSON** — not filterable; loses the printing link to catalog.
- [ ] **Required printing_id** — many users won't know/care about the exact printing; too rigid.

| Q | Choice |
|---|--------|
| Q1 | Quantity-stacked by tuple |
| Q2 | Surrogate UUID |
| Q3 | user_id FK + query filter |
| Q4 | Optional printing FK + enum text cols |

#### Round 2: API, auth, validation
##### Q5. How does a server handler get the session user?
- [x] **New `requireUser(event)` util using `useAuth().api.getSession`** — (Recommended) first reusable server-side auth gate; consistent 401; reused by all inventory handlers.
- [ ] **Proxy to `/api/auth/get-session` internally** — extra round trip; Better Auth exposes `api.getSession` directly.
- [ ] **Trust a header** — insecure.

##### Q6. Where does the add flow start?
- [x] **Catalog search result "Add" action opening a modal, plus an inventory-page CTA** — (Recommended) natural: you find a card then add it; owns the modal here, hooks into 82gj.
- [ ] **Manual free-text card name only (no catalog link)** — breaks the catalog-reference principle.
- [ ] **Barcode/passcode entry only** — Phase 2 territory; too narrow for MVP.

##### Q7. Where does the inventory list join catalog data?
- [x] **Server-side join in `GET /api/inventory`** — (Recommended) thin client; single query returns name/type/image/set; easy pagination.
- [ ] **Client fetches catalog per row** — N+1 requests; slow.

##### Q8. Edit vs delete semantics?
- [x] **PATCH for quantity/details, DELETE to remove; quantity<1 on PATCH → 400** — (Recommended) explicit, avoids "quantity 0" ghost rows; re-dedupe on edits that collide.
- [ ] **PATCH quantity 0 auto-deletes** — surprising, hides destructive action behind an update.

##### Q9. Validation approach?
- [x] **Hand-rolled validators in `server/utils/inventory.ts`** — (Recommended) matches the dependency-light server code (no Zod present); shared with tests.
- [ ] **Add Zod** — new dep for a small validation surface; avoid.

| Q | Choice |
|---|--------|
| Q5 | requireUser util |
| Q6 | Catalog "Add" + inventory CTA |
| Q7 | Server-side join |
| Q8 | PATCH/DELETE, no qty-0 |
| Q9 | Hand-rolled validators |

#### Round 3: Coupling, ADR, shippability
##### Q10. Is a new ADR needed?
- [x] **Yes — "Owned-card (inventory) data model"** — (Recommended) first user-owned domain schema + ownership-boundary + grain decision are structural per WORKFLOW §7.
- [ ] **No ADR** — would leave a cross-cutting schema/pattern unrecorded; violates guardrails.

##### Q11. How to avoid hard-blocking on 82gj (catalog search UI)?
- [x] **Own the add modal + API here; ship a minimal `CatalogCardPicker` name-search fallback so inventory is independently usable** — (Recommended) keeps this bean shippable even if 82gj lands later; 82gj wires the same modal into its richer results.
- [ ] **Hard-depend on 82gj's search UI** — couples two beans' delivery unnecessarily.
- [ ] **Duplicate a full catalog search here** — overlaps 82gj; wasteful.

##### Q12. FK types against 23wn's schema?
- [x] **`catalog_card_id` integer → catalog_card.id; `printing_id` text nullable → catalog_printing.id** — (Recommended) exactly matches 23wn's approved PK types (integer passcode, text set_code).
- [ ] **Store passcode as text** — type-mismatch with catalog PK; breaks the FK.

| Q | Choice |
|---|--------|
| Q10 | New ADR |
| Q11 | Own modal/API + fallback picker |
| Q12 | integer card FK + text printing FK |

</details>

_Plan promoted by orchestrator on behalf of the user, 2026-07-04._
