---
# yugioh-alpha-82gj
title: Card catalog search and filtering
status: todo
type: feature
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:26:28Z
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
