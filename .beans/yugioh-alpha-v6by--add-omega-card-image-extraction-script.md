---
# yugioh-alpha-v6by
title: Add Omega card image extraction script
status: completed
type: task
priority: normal
created_at: 2026-07-04T21:12:39Z
updated_at: 2026-07-04T21:15:00Z
---

Add a repo script that extracts browser-friendly card images from copied YGO Omega Unity bundles.\n\n- [x] Inspect project script conventions\n- [x] Add extraction script\n- [x] Add package command and docs\n- [x] Verify dry-run/help behavior

## Summary of Changes\n\nAdded scripts/extract-omega-card-images.py to extract Texture2D/Sprite assets from copied YGO Omega Unity bundles into public/assets/cards/de. Added pnpm assets:extract:omega and README usage notes. Verified CLI help, package script wiring, missing dependency messaging, and Python syntax compilation with PYTHONPYCACHEPREFIX set to /tmp.
