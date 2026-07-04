---
# yugioh-alpha-ah9j
title: Voice input for card entry
status: todo
type: feature
created_at: 2026-07-04T19:09:14Z
updated_at: 2026-07-04T19:09:14Z
parent: yugioh-alpha-zupu
blocked_by:
    - yugioh-alpha-qkkv
---

## Problem

When sorting physical cards, hands are busy — speaking card names ("Blue-Eyes White Dragon, three copies") is faster than typing.

## Proposed Solution

- Voice capture (Web Speech API or similar; planner to decide) with per-utterance transcription.
- Transcripts parsed into card name + optional quantity, run through catalog fuzzy matching, feeding the staged-entry review flow.
- Continuous dictation mode for entering many cards in a row.

## Effort

Medium

Builds on the entry review/correction flow (blocked-by relation).
