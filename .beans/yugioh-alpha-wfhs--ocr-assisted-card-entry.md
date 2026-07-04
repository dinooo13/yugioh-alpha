---
# yugioh-alpha-wfhs
title: OCR-assisted card entry
status: todo
type: feature
created_at: 2026-07-04T19:09:14Z
updated_at: 2026-07-04T19:09:14Z
parent: yugioh-alpha-zupu
blocked_by:
    - yugioh-alpha-qkkv
---

## Problem

Card names and set codes are printed on the card. OCR on a photo region can extract them for matching without full image recognition.

## Proposed Solution

- OCR extraction of card name and/or set code from a photo or camera frame.
- Extracted text runs through catalog fuzzy matching; candidates land in the staged-entry review flow.
- Planner to decide OCR approach (client-side library vs server-side) and how this relates to/reuses the photo-recognition capture UI.

## Effort

Medium

Builds on the entry review/correction flow (blocked-by relation); overlaps in capture UI with photo-based recognition — planner should reconcile.
