---
# yugioh-alpha-qkkv
title: Entry review and correction flow with suggested matches
status: todo
type: feature
created_at: 2026-07-04T19:09:14Z
updated_at: 2026-07-04T19:09:14Z
parent: yugioh-alpha-zupu
blocked_by:
    - yugioh-alpha-wxy4
---

## Problem

All fast-entry methods (photo, OCR, voice, bulk) produce candidate cards that may be wrong. Users need a shared staging step: see suggested catalog matches for each candidate, correct or reject them, set ownership details, and only then save to the inventory. Without this, every entry method would need its own ad-hoc confirmation UX.

## Proposed Solution

- A staged-entry concept (pending entries with candidate catalog matches and confidence/ambiguity), independent of how candidates were produced.
- Suggested-match resolution: fuzzy name matching against the catalog, showing top candidates with images for quick visual confirmation.
- Review UI: list of pending entries, per-entry match correction (pick another candidate / manual search), ownership fields (quantity, language, condition, edition, collection), batch confirm to inventory, discard.
- Designed as the funnel that photo/OCR/voice/bulk beans feed into.

## Effort

Large

Depends on the owned-card inventory model (yugioh-alpha-wxy4).
