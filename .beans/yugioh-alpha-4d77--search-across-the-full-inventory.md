---
# yugioh-alpha-4d77
title: Search across the full inventory
status: todo
type: feature
priority: normal
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:26:28Z
parent: yugioh-alpha-brmu
blocked_by:
    - yugioh-alpha-wxy4
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
