---
# yugioh-alpha-wxy4
title: Manual inventory entry with owned card quantities
status: todo
type: feature
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:26:28Z
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
