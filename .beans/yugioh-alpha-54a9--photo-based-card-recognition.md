---
# yugioh-alpha-54a9
title: Photo-based card recognition
status: todo
type: feature
created_at: 2026-07-04T19:09:14Z
updated_at: 2026-07-04T19:09:14Z
parent: yugioh-alpha-zupu
blocked_by:
    - yugioh-alpha-qkkv
---

## Problem

Typing card names is the slowest part of entry. Users should be able to photograph a card (or several) and have the app identify it.

## Proposed Solution

- Photo capture/upload (mobile camera + file upload).
- Recognition pipeline that turns the photo into candidate catalog matches (approach — e.g. image matching against catalog artwork, an external recognition service, or a vision model — to be decided by the planner).
- Candidates feed the staged-entry review flow with confidence indicators; low-confidence results fall back to manual search.

## Effort

Large

Builds on the entry review/correction flow (blocked-by relation).
