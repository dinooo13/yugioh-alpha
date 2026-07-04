---
# yugioh-alpha-f785
title: Collections and storage locations
status: todo
type: feature
priority: normal
tags:
    - blocked
    - effort:medium
    - area:inventory
    - area:ui
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T19:19:23Z
parent: yugioh-alpha-brmu
blocked_by:
    - yugioh-alpha-wxy4
---

## Problem

Owned cards need to be organized into collections/storage locations (Box 1, binder, trade pile, ...) so the inventory maps to physical storage. Currently there is no collection concept.

## Proposed Solution

- collection table (per user: name, optional description).
- Owned cards assignable to a collection; unassigned cards still visible in the all-cards view.
- Collection management UI: create, rename, delete; per-collection card lists and counts.

## Effort

Medium

Depends on the owned-card model (blocked-by relation).

<!-- routine:plan -->
## Plan

> Add user-owned **collections** (Box 1, binder, trade pile, …) so owned cards map to physical storage: a `collection` table plus an optional `collection_id` on `owned_card`, collection CRUD APIs, a real sidebar collection list (replacing the hardcoded one in `app/layouts/default.vue`), and per-collection filtering of the inventory — building directly on the `owned_card` model from yugioh-alpha-wxy4.

### Dependency assumptions (blocked-by yugioh-alpha-wxy4)

This plan is written **against wxy4's approved `owned_card` schema** and assumes it lands first. It relies on:

- `owned_card` exists in `server/db/schema.ts` with surrogate **text UUID `id`**, `user_id` (text notNull → `user.id` cascade), `catalog_card_id` (integer FK), `printing_id` (text nullable FK), `quantity`, `language`/`condition`/`edition`, `note`, `created_at`/`updated_at`, and indexes `idx_owned_card_user`, `idx_owned_card_user_card`.
- `server/utils/session.ts` `requireUser(event)` (401 if no session) — reused by every collection handler.
- `server/utils/inventory.ts` (validators, catalog-join select builder) and the existing `GET /api/inventory` list handler with `?q=`/pagination — this bean **extends** that handler with an optional `?collectionId=` filter rather than duplicating the join.
- `app/pages/inventar.vue` is the real inventory view (list + add/edit/remove) from wxy4; this bean adds a collection filter and an assign-to-collection control there.
- Migrations generated with `pnpm db:generate`, applied by `server/plugins/migrate.ts` at startup. This bean's migration must be generated **after** wxy4's `owned_card` migration (the `collection_id` FK is added to `owned_card`).

If wxy4's final `owned_card` PK type/name deviates, the implementer adjusts the `collection_id` column addition and the join accordingly; nothing else here changes structurally. From the catalog (yugioh-alpha-23wn / ADR 0001) this bean needs nothing beyond what `owned_card` already references.

### 1. Overview

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Collection ↔ owned-card relation | **Nullable `owned_card.collection_id`** (an owned-card stack lives in at most one collection). Unassigned rows (`NULL`) appear in "Alle Karten" but no specific collection. Not a many-to-many join table (physical cards live in one box). |
| Q2 | Collection scope / ownership | Per-user `collection` table: `user_id` notNull → `user.id` cascade; every query filters by session user via `requireUser`. |
| Q3 | Collection PK & identity | Surrogate **text UUID `id`** (matches `user.id`/`owned_card.id` convention). Name unique **per user** (app-validated, case-insensitive-trimmed), not a DB unique index. |
| Q4 | "Alle Karten" (all cards) | A **virtual view**, not a stored row — it is simply the unfiltered inventory. Only real, user-created collections are stored. Keeps the model honest and avoids a magic seed row per user. |
| Q5 | Delete behavior | Deleting a collection **unassigns** its cards (`collection_id → NULL`, cards survive in "Alle Karten"), via `ON DELETE SET NULL`. Confirmation dialog states cards are kept. |
| Q6 | Assigning cards to a collection | Two paths: (a) at add-time — optional collection USelect in wxy4's `AddToInventoryModal`; (b) after the fact — `PATCH /api/inventory/:id { collectionId }` (extends wxy4's PATCH; `null` = unassign). No new bulk-move endpoint in this bean (deferred). |
| Q7 | Counts | Each collection carries a **card count = SUM(quantity)** of its owned rows for the user, computed server-side in `GET /api/collections`. "Alle Karten" count = SUM over all the user's rows. |
| Q8 | Sidebar list source | Replace the hardcoded `collections` array in `app/layouts/default.vue` with a real fetch of `GET /api/collections`; "Neue Sammlung" button opens a create dialog; clicking a collection navigates to `/inventar?collectionId=<id>` (and "Alle Karten" to `/inventar`). |
| Q9 | Management UI surface | Lightweight: create via sidebar dialog; rename/delete via a small per-collection menu (kebab) in the sidebar **and** a header control on `/inventar` when a collection is active. No separate `/collections` route (keeps navigation flat; the sidebar *is* the collection nav). |
| Q10 | Validation | Extend `server/utils/inventory.ts` (or a sibling `server/utils/collections.ts`): non-empty trimmed name ≤ 60 chars, optional description ≤ 500, name unique per user (409 on collision); `collectionId` on inventory PATCH must reference a collection owned by the same user (else 400). Hand-rolled, no Zod (matches wxy4). |
| Q11 | ADR | **No new ADR.** wxy4's "Owned-card (inventory) data model" ADR already establishes the user-owned schema, ownership-boundary (`requireUser` + per-user filtering) and app-level-validation patterns; collections extend that model additively (one new table + one nullable FK) without changing persistence, auth, or a cross-cutting pattern. Note the addition in that ADR's context if it is still open; otherwise none. |

### 2. Data model

Extend `server/db/schema.ts` (same file, `drizzle-orm/sqlite-core`, matching existing style).

#### New table `collection`

| Field | Type | Notes |
|-------|------|-------|
| id | text PK | UUID (`crypto.randomUUID()`), matches `user.id`/`owned_card.id` |
| user_id | text notNull → `user.id` cascade | ownership boundary; indexed |
| name | text notNull | trimmed, ≤ 60 chars; unique per user (app-validated) |
| description | text | optional, ≤ 500 chars |
| created_at | integer `{mode:'timestamp'}` notNull | |
| updated_at | integer `{mode:'timestamp'}` notNull | |

Index: `idx_collection_user` on `user_id`. `relations()`: `collection` belongsTo `user`, hasMany `owned_card`.

#### Alter `owned_card` — add one column

| Field | Type | Notes |
|-------|------|-------|
| collection_id | text → `collection.id` **set null** | nullable; the owning collection, or NULL = "Alle Karten" only. Indexed: `idx_owned_card_collection` on `collection_id`. |

**Grain note:** because wxy4 keys an owned row by `(user, card, printing, language, condition, edition)` and dedupes on add, `collection_id` becomes part of the physical identity — the same card in two boxes is two `owned_card` rows. The implementer must add `collection_id` to wxy4's upsert-match tuple in `server/utils/inventory.ts` so "add BEWD to Box 1" and "add BEWD to Box 2" produce distinct rows, while re-adding to the *same* collection still increments quantity. This is the one cross-cutting change into wxy4's code.

**Migration:** `pnpm db:generate` emits `server/db/migrations/000X_*.sql` + snapshot: `CREATE TABLE collection`, `ALTER TABLE owned_card ADD COLUMN collection_id` (SQLite adds nullable columns without a table rebuild), indexes. All-additive; existing `owned_card` rows default to `collection_id = NULL` (visible in "Alle Karten"). Must be generated **after** wxy4's `owned_card` migration.

### 3. Server API

All handlers call `requireUser(event)` and scope every read/write with `eq(collection.userId, user.id)` / `eq(ownedCard.userId, user.id)`.

New `server/utils/collections.ts`: allowed-length constants, `validateCollectionInput(body)` (trimmed non-empty name ≤ 60, description ≤ 500 → normalized or throws 400), and `assertCollectionOwnedByUser(db, userId, collectionId)` reused by inventory PATCH.

| Method | Route (new file) | Behavior |
|--------|------------------|----------|
| GET | `server/api/collections/index.get.ts` | List current user's collections with `cardCount = SUM(quantity)` (left join `owned_card`, group by collection); ordered by name. Returns `{ items, allCount }` where `allCount` = SUM(quantity) over all the user's owned rows (for "Alle Karten"). |
| POST | `server/api/collections/index.post.ts` | Create: validate; reject duplicate name for user (409); insert UUID row; 201 with the row (`cardCount: 0`). |
| PATCH | `server/api/collections/[id].patch.ts` | Rename / edit description of own collection; 404 if not owned; 409 on name collision; 200. |
| DELETE | `server/api/collections/[id].delete.ts` | Delete own collection; 404 if not owned. FK `ON DELETE SET NULL` unassigns its cards; 204. |

**Extend wxy4's `server/api/inventory/index.get.ts`:** accept optional `?collectionId=<id>` — when present, add `eq(ownedCard.collectionId, collectionId)` (after asserting ownership of that collection → 404 if not owned). Absent = all cards.

**Extend wxy4's `server/api/inventory/[id].patch.ts` + `index.post.ts`:** accept optional `collectionId` (string | null); validate it references a user-owned collection (`assertCollectionOwnedByUser`, else 400); include `collection_id` in the upsert-match tuple (§2 grain note).

**Flow (assign existing card to a box):**
```
PATCH /api/inventory/:id { collectionId } ─► requireUser
  ─► load owned row (must belong to user, else 404)
  ─► collectionId != null? assertCollectionOwnedByUser (else 400)
  ─► if new tuple (incl. collection_id) collides with another owned row → merge quantities (wxy4 re-dedupe path)
  ─► else UPDATE collection_id ─► 200
```

### 4. UI

**Sidebar — `app/layouts/default.vue` (replace hardcoded `collections` array):**
```
┌──────────────────────────┐
│  SAMMLUNGEN              │
│  ● Alle Karten     1248  │  → /inventar
│  ● Box 1            412  │  → /inventar?collectionId=…  [⋯ rename/delete]
│  ● Binder          289   │
│  …                       │
│  [ + Neue Sammlung ]     │  → opens create dialog
└──────────────────────────┘
```
- Fetch `GET /api/collections` (cookie-forwarded, SSR-friendly like the existing `getAuthSession` call). "Alle Karten" is a synthetic first item using `allCount`; each real collection links to `/inventar?collectionId=<id>` with its `cardCount`.
- Active collection (matches current `?collectionId`) highlighted.
- "Neue Sammlung" opens a `CollectionFormModal` (name + optional description). On save, refresh the list.
- Per-collection kebab (`i-lucide-more-horizontal`) → rename (same modal, pre-filled) / delete (confirm dialog stating cards are kept). Colored dot kept as a deterministic hash of the collection id (cosmetic; no color column).

**Inventory page — `app/pages/inventar.vue` (extend wxy4's view):**
- Read `route.query.collectionId`; pass to `useFetch('/api/inventory', { query: { collectionId, q, page } })`. Header shows the active collection name + count, or "Alle Karten".
- Each row gets an assign control (USelect of the user's collections + "— (keine)") that PATCHes `collectionId`; wxy4's `AddToInventoryModal` gains an optional collection USelect so new cards can be placed on add.
- Empty state for an empty collection: "Noch keine Karten in dieser Sammlung" + link to add.

**New components:**
- `app/components/collections/CollectionFormModal.vue` — create/rename (name + description), POST/PATCH `/api/collections`, emits `saved`.
- `app/components/collections/CollectionSidebar.vue` (optional extraction) — the SAMMLUNGEN list + dialogs, to keep `default.vue` lean. Uses Nuxt UI (`UNavigationMenu`/`UButton`/`UModal`/`UInput`/`UDropdownMenu`).

### 5. Affected files

New:
- `server/db/schema.ts` (extend) — `collection` table + `owned_card.collectionId` column + indexes + relations.
- `server/db/migrations/000X_*.sql` + `meta/` (generated).
- `server/utils/collections.ts` — validators + `assertCollectionOwnedByUser`.
- `server/api/collections/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`.
- `app/components/collections/CollectionFormModal.vue` (+ optional `CollectionSidebar.vue`).
- `tests/nuxt/collections-api.test.ts`, `tests/nuxt/collections-ui.test.ts`.

Touched (from wxy4 — coordinate ordering):
- `server/utils/inventory.ts` — add `collection_id` to the upsert-match tuple + collection-owned validation.
- `server/api/inventory/index.get.ts` — `?collectionId=` filter.
- `server/api/inventory/index.post.ts`, `[id].patch.ts` — accept/validate `collectionId`.
- `app/pages/inventar.vue` — collection filter + per-row assign; `app/components/inventory/AddToInventoryModal.vue` — optional collection select.
- `app/layouts/default.vue` — real collection sidebar.
- The wxy4 ADR — note collections as an additive extension (if still open).

### Dependencies

None new. Reuses `drizzle-orm`, `better-sqlite3`, Nitro `$fetch`/`useFetch`, `better-auth` (`requireUser`), `@nuxt/ui`, `crypto.randomUUID()`. Validation stays hand-rolled (no Zod), matching wxy4.

### Docs & ADR impact

- **No new ADR.** Collections are an additive extension of the owned-card model whose structural decisions (per-user ownership boundary, `requireUser`, app-level validation, UUID PKs) are already covered by wxy4's inventory ADR. Add a short note to that ADR's context recording collections (one table + nullable `collection_id`, delete = set-null) if it is still open; if already accepted, leave it and rely on this bean's plan/PR.
- `docs/Roadmap.md` — no change (design conforms to "a collection is a way to organize owned cards").
- `README.md` — optional one-line note that cards can be organized into collections (verify at build).

### Test plan

| # | Test case | Type | Steps | Expected |
|---|-----------|------|-------|----------|
| 1 | `validateCollectionInput` accepts valid | unit | name "Box 1", desc | normalized (trimmed) fields |
| 2 | `validateCollectionInput` rejects bad | unit | empty/whitespace name, 61-char name, 501-char desc | throws 400 |
| 3 | POST creates a collection | nuxt | Auth'd POST valid body | 201; one `collection` row scoped to user, `cardCount` 0 |
| 4 | POST rejects duplicate name per user | nuxt | POST same name twice | 409 second time |
| 5 | GET lists user's collections with counts | nuxt | seed collections + owned rows (qty), GET | items with `cardCount = SUM(quantity)`; `allCount` correct |
| 6 | GET scoped to user | nuxt | seed collections for A & B; GET as A | only A's collections |
| 7 | PATCH renames own collection | nuxt | Auth'd PATCH own row | 200; renamed; 409 on collision |
| 8 | PATCH/DELETE on another user's collection | nuxt | Auth'd as B target A's collection | 404 |
| 9 | DELETE unassigns cards | nuxt | collection with owned rows, DELETE | 204; rows survive with `collection_id NULL`; appear in unfiltered inventory |
| 10 | Inventory `?collectionId=` filters | nuxt | rows in Box 1 + unassigned, GET `?collectionId=Box1` | only Box 1 rows |
| 11 | Assign via inventory PATCH | nuxt | PATCH owned row `{collectionId}` | 200; row's `collection_id` set; invalid/foreign collectionId → 400 |
| 12 | Add same card to two collections = two rows | nuxt | POST card to Box1 then Box2 | two `owned_card` rows; re-add to Box1 increments qty |
| 13 | Unauthenticated requests rejected | nuxt | call each collection endpoint w/o session | 401 |
| 14 | Sidebar renders real collections + empty state | nuxt | mount layout/`CollectionSidebar` with mocked fetch | "Alle Karten" + collections shown; create dialog opens |
| 15 | Delete confirm states cards kept | nuxt | open delete dialog | copy states cards move to "Alle Karten" |

Done = verification gates green per `docs/WORKFLOW.md` §5 (`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm lint`), with tests for every behavior change.

### Suggested classification & branch

Tags: `effort:medium`, `area:inventory` (both already present and correct — confirmed medium: additive schema + 4 CRUD endpoints + sidebar rewrite, no new deps). Add `area:ui` (sidebar/inventory UI is a substantial part). Branch: `claude/f785-collections-and-storage-locations`.

### Out of scope

- Inventory-wide search across all collections (yugioh-alpha-4d77 — separate bean).
- Bulk move/multi-select assignment of many cards at once (defer; single-row assign only).
- Collection sharing/permissions, colors as a stored attribute, collection ordering/drag-drop, nested collections.
- A card belonging to multiple collections simultaneously (single `collection_id` by design; revisit only if product needs it).

<details>
<summary>Brainstorming record (auto-resolved)</summary>

#### Round 1: Data model & relation
##### Q1. How does a collection relate to owned cards?
- [x] **Nullable `owned_card.collection_id` (one collection per owned-card stack)** — (Recommended) mirrors physical reality (a card sits in one box); simplest counts/filtering; set-null on delete keeps cards. Grain already keyed per physical variant in wxy4.
- [ ] **Many-to-many join table** — a card in multiple collections at once; doesn't match physical storage, complicates counts, over-modeled for Phase 1.
- [ ] **`collection_id` on a per-copy row** — wxy4 uses quantity stacks, not per-copy rows; incompatible.

##### Q2. Collection ownership scope?
- [x] **Per-user table, `user_id` notNull cascade, `requireUser` on every query** — (Recommended) matches wxy4's ownership-boundary pattern exactly.
- [ ] **Global/shared collections** — contradicts Roadmap (collections organize *a user's* owned cards); sharing is Phase 6.

##### Q3. Collection PK & name uniqueness?
- [x] **UUID text PK; name unique per user, app-validated** — (Recommended) matches `user.id`/`owned_card.id`; avoids SQLite partial-unique-index quirks (same approach wxy4 took).
- [ ] **Autoincrement integer PK** — inconsistent with the text-id convention elsewhere.
- [ ] **DB unique index on (user_id, name)** — works but wxy4 chose app-level uniqueness; stay consistent, and case-insensitive uniqueness is easier in app code.

| Q | Choice |
|---|--------|
| Q1 | Nullable `owned_card.collection_id` |
| Q2 | Per-user table + requireUser |
| Q3 | UUID PK, app-validated per-user name |

#### Round 2: "Alle Karten", deletion, assignment
##### Q4. Is "Alle Karten" a stored collection?
- [x] **Virtual (unfiltered inventory), not stored** — (Recommended) no magic seed row per user; the sidebar renders it from `allCount`. The existing layout already treats it as first item.
- [ ] **Seed a real "Alle Karten" row per user** — every card would need to also belong to it → back to many-to-many; rejected.

##### Q5. What happens on collection delete?
- [x] **Unassign cards (`collection_id → NULL` via ON DELETE SET NULL), cards survive** — (Recommended) safest; cards remain in inventory/"Alle Karten"; matches "storage location removed, cards still owned".
- [ ] **Cascade-delete the owned cards** — destroys inventory data on a rename-gone-wrong; dangerous.
- [ ] **Block delete while non-empty** — annoying UX; forces manual reassignment.

##### Q6. How are cards assigned to a collection?
- [x] **Add-time optional select + after-the-fact inventory PATCH `{collectionId}`** — (Recommended) reuses wxy4's modal and PATCH; `null` unassigns; no new endpoint.
- [ ] **Dedicated move endpoint** — extra surface; single-row assign via existing PATCH suffices for Phase 1.

| Q | Choice |
|---|--------|
| Q4 | Virtual "Alle Karten" |
| Q5 | Set-null on delete |
| Q6 | Add-time select + inventory PATCH |

#### Round 3: Counts, UI surface, validation
##### Q7. How are collection counts computed?
- [x] **Server-side `SUM(quantity)` per collection in GET /api/collections** — (Recommended) authoritative, single query, matches deck-availability SUM approach; "Alle Karten" = SUM over all user rows.
- [ ] **Client counts from the inventory list** — inaccurate when paginated/filtered.
- [ ] **Denormalized count column** — needs triggers/upkeep; premature.

##### Q8. Where does collection nav/management live?
- [x] **The sidebar SAMMLUNGEN list is the nav; create dialog + per-item kebab for rename/delete; header control on /inventar** — (Recommended) the layout already has this exact affordance stubbed; make it real, keep navigation flat.
- [ ] **Separate `/collections` management route** — extra route for little gain; sidebar already lists them.

##### Q9. Validation approach?
- [x] **Hand-rolled `server/utils/collections.ts` (name/description limits, per-user uniqueness, owned-collection assertion), no Zod** — (Recommended) matches wxy4's dependency-light server code.
- [ ] **Introduce Zod** — new dependency; contradicts the established pattern.

| Q | Choice |
|---|--------|
| Q7 | Server-side SUM(quantity) |
| Q8 | Sidebar-as-nav + dialogs |
| Q9 | Hand-rolled validators |

#### Round 4: Persistence, migration, ADR
##### Q10. Migration shape?
- [x] **Additive: CREATE collection + ALTER owned_card ADD collection_id (nullable), generated after wxy4's migration** — (Recommended) SQLite adds nullable columns cheaply; no data migration; existing rows default NULL.
- [ ] **Rebuild owned_card table** — unnecessary for a nullable column add.

##### Q11. Upsert-tuple interaction with wxy4?
- [x] **Add `collection_id` to wxy4's upsert-match tuple** — (Recommended) so the same card in different boxes are distinct rows while re-adding to the same box increments quantity — the one intentional edit into wxy4's `inventory.ts`.
- [ ] **Ignore collection in dedupe** — would collapse Box1/Box2 stacks into one row; wrong.

##### Q12. New ADR needed?
- [x] **No new ADR (additive extension of wxy4's inventory ADR)** — (Recommended) no change to persistence/auth/core-dependency/cross-cutting pattern; note in that ADR if still open.
- [ ] **New ADR** — over-documents a one-table additive change already governed by an accepted ADR.

| Q | Choice |
|---|--------|
| Q10 | Additive migration after wxy4 |
| Q11 | collection_id in upsert tuple |
| Q12 | No new ADR |

</details>

_Plan promoted by orchestrator on behalf of the user, 2026-07-04._

## Progress

_Current step: blocked on yugioh-alpha-wxy4_

- [ ] Implement collection/storage-location schema, API, UI, tests, and docs after the owned-card inventory model lands.

### Blocker

Implementation cannot start safely because the planned dependency from yugioh-alpha-wxy4 is not present on origin/main: server/db/schema.ts has no owned_card table, server/utils/session.ts requireUser is absent, server/utils/inventory.ts is absent, and the inventory API/UI hooks this bean must extend do not exist yet. Per the f785 plan and implementer instructions, this bean is blocked rather than inventing conflicting owned-card storage.
