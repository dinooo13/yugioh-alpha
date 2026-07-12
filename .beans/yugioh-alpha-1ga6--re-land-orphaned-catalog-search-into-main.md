---
# yugioh-alpha-1ga6
title: Re-land orphaned catalog search into main
status: in-progress
type: bug
priority: high
tags:
    - area:ui
    - effort:medium
    - needs-review
    - area:catalog
created_at: 2026-07-12T14:23:37Z
updated_at: 2026-07-12T14:34:42Z
---

## Problem

The catalog search & filtering feature (bean yugioh-alpha-82gj, PR #3) was implemented and QA-approved, but its code never landed in `main`: PR #3 was merged into the `claude/23wn-global-card-catalog` branch instead of `main`, and 23wn had already merged to main via PR #2. The bean was then swept as "completed", so the tracker shows the feature done while `main` has no `/katalog` page and no `/api/catalog/*` endpoints.

## Proposed Solution

Re-land the orphaned catalog-search surface from `origin/claude/82gj-card-catalog-search` onto a fresh branch off current `main`:
- `app/pages/katalog.vue` (German catalog UI: search, filters, pagination, detail slideover)
- `server/api/catalog/cards/index.get.ts`, `server/api/catalog/cards/[id].get.ts`, `server/api/catalog/facets.get.ts`
- `server/utils/catalog-search.ts`, `server/utils/catalog-query.ts`
- catalog nav link in `app/layouts/default.vue`
- tests: `catalog-search.test.ts`, `catalog-query.test.ts`, `katalog-page.test.ts`

Reconcile auth with the current `server/utils/session.ts` `requireUser` convention (drop the redundant `require-session.ts` if clean). Run all gates and open a PR.

## Notes

Reads only catalog tables (from 23wn, already in main). Distinct from yugioh-alpha-4d77 (inventory search over owned cards).

Relates to yugioh-alpha-82gj (original, mis-merged) and is independent of yugioh-alpha-4d77 (inventory search).

## Delivery

Branch: `claude/1ga6-catalog-search-reland`
PR: https://github.com/dinooo13/yugioh-alpha/pull/7

## Summary of Changes

Re-landed the orphaned 82gj catalog-search surface onto current main: `/katalog` page, `/api/catalog/*` endpoints, and query helpers, plus the Katalog nav link and tests. Reconciled auth to `requireUser` (dropped `require-session.ts`) and renamed `searchCatalogCards`→`searchCatalog` to avoid an auto-import clash with wxy4's inventory helper. Gates green (typecheck/lint/build; 49 tests) and verified end-to-end in the browser against the real 14k-card catalog.
