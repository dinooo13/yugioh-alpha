---
# yugioh-alpha-f785
title: Collections and storage locations
status: draft
type: feature
priority: normal
tags:
    - needs-plan
    - effort:medium
    - area:inventory
created_at: 2026-07-04T18:26:28Z
updated_at: 2026-07-04T18:30:16Z
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
