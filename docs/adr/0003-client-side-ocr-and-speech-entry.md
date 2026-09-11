# 0003: Client-side OCR and speech entry, server-side matching

## Status

Accepted

## Context

Phase 2 of the [Roadmap](../Roadmap.md) asks for photo-based card
recognition, OCR-assisted entry, and voice input, all funnelled through a
review-and-correction step before anything is written to the inventory.

Three questions had to be answered before building the "Schnellerfassung"
page:

1. Where does OCR run — in the browser, on our server, or in a third-party
   vision API?
2. Where does speech recognition come from — a dependency, a hosted service,
   or the browser?
3. Where does a recognized string become a catalog card?

The app is a small self-hosted Nuxt/SQLite deployment (see
[0001](0001-card-catalog-data-model.md)) with no background workers, no
object storage, and no external API credentials. Adding a cloud vision or
speech service would introduce the first paid third-party dependency, the
first outbound upload of user data, and secrets to manage. Running OCR in
Nitro would mean a native Tesseract binary (or a WASM runtime) plus image
uploads, temp files, and CPU spikes on the same process that serves every
request.

## Decision

### OCR runs in the browser

Photo entry uses [`tesseract.js`](https://github.com/naptha/tesseract.js),
loaded through a **dynamic, client-only import inside the upload handler**
(`app/pages/inventar/erfassen.vue`). The picked/dropped/captured image is
recognized locally and only the extracted *text* is sent to the server.

Consequences:

- **Privacy**: card photos never leave the device; no image upload endpoint,
  no temporary files, no retention question to answer.
- **Zero server cost**: no vision API bill, no API keys, no rate limits, and
  no OCR load on the Nitro process — recognition scales with the number of
  users' own devices.
- **No SSR/bundle impact elsewhere**: because the import is dynamic and
  guarded by `import.meta.client`, the worker and WASM core stay out of the
  server bundle and out of every other page's chunk; they are only fetched
  when someone actually opens the Foto tab and picks an image.
- **Costs**: the first recognition downloads the Tesseract WASM core and the
  `eng` traineddata (a few MB, from the package's default CDN) and runs at
  device speed. Recognition quality depends on the photo. Only the `eng`
  model is used — English card names are what the catalog stores, so the
  German UI still reads English cards.

### Speech uses the native Web Speech API

Voice entry uses `SpeechRecognition` / `webkitSpeechRecognition` directly —
no dependency, no service. The page feature-detects the constructor and shows
a friendly German hint when the browser has no support, and it offers a
`de-DE` / `en-US` toggle plus continuous listening.

Consequences:

- **No new dependency and no server involvement** for the voice path.
- **Browser-dependent**: it works in Chrome/Edge and Safari, and is absent in
  Firefox, where the tab degrades to the hint. In Chrome the audio is
  processed by the browser vendor's service, which is out of our control —
  unlike OCR, this path is not an offline/private guarantee, which is one
  more reason not to build it into the server.
- The transcript lands in an editable textarea, so a misheard line can be
  fixed before it is looked up.

### Matching happens server-side

All three input modes (Liste, Foto, Sprache) end up as plain strings that are
posted to `POST /api/inventory/entry/suggest`. Parsing (`3x Dark Magician`,
`Dark Magician (SDY-006)`, bare set codes and passcodes) and candidate
ranking live in `server/utils/card-entry.ts`, next to the catalog they query.

Consequences:

- The 14k-card catalog is never shipped to the client. Matching is a
  prefilter plus in-memory scoring: exact identifiers (passcode, set code)
  are looked up directly, name lookups run bounded `LIKE` prefilters (the
  whole query first, ordered so the closest names win, then per-token
  patterns to fill a capped candidate pool), and only that pool is scored
  with the bigram similarity. Display data (images, printings) is fetched
  for the final ranked ids only, so no scan carries a join.
- One ranking implementation serves every input mode — improving fuzzy
  matching for OCR automatically improves it for speech and typing.
- Suggesting is read-only. Cards are written only when the user confirms the
  review table, through `POST /api/inventory/bulk`, which re-validates every
  item and writes the batch in one transaction.

## Alternatives considered

- **Cloud vision / speech APIs (Google, AWS, Azure)**: better accuracy, but
  they add cost, secrets, outbound upload of user photos, and an external
  dependency in a self-hosted app. Rejected for Phase 2.
- **OCR in Nitro (native Tesseract or WASM on the server)**: keeps the client
  light, but requires image uploads plus storage/cleanup and puts an
  unpredictable CPU load on the single app process. Rejected.
- **Card-art recognition (perceptual hashing / image embeddings against
  catalog artwork)**: the stronger long-term answer to "photo-based card
  recognition", but it needs locally cached card images (still an open
  follow-up from ADR 0001) and an index that does not exist yet. Not part of
  this decision; OCR of the card name/set code covers the phase goal today.

- A photo is treated as *one card*: every string the OCR pass extracts (set
  code, passcode, name lines) is looked up, but the results are merged into a
  single reviewable row whose alternatives are the union of those lookups.

## Notes

`tesseract.js`'s only install script is the OpenCollective donation notice,
so it is pinned to `false` in `pnpm-workspace.yaml`'s `allowBuilds` map.
