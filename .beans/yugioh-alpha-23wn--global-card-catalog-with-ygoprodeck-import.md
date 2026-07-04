---
# yugioh-alpha-23wn
title: Global card catalog with YGOPRODeck import
status: draft
type: feature
priority: normal
tags:
    - needs-plan
    - effort:large
    - area:catalog
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:29:27Z
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
