---
# yugioh-alpha-t7r8
title: Bulk entry workflows
status: todo
type: feature
created_at: 2026-07-04T19:09:14Z
updated_at: 2026-07-04T19:09:14Z
parent: yugioh-alpha-zupu
blocked_by:
    - yugioh-alpha-qkkv
---

## Problem

Adding a large collection card-by-card through search is slow. Users need workflows to enter many cards in one sitting.

## Proposed Solution

- Rapid-entry mode: keyboard-first successive name entry feeding the staged-entry review flow.
- Paste/import a list (one card name per line, optionally with quantity/set code) that is matched in bulk and lands in the review flow.
- Defaults that persist across entries in a session (target collection, language, condition).

## Effort

Medium

Builds on the entry review/correction flow (blocked-by relation).
