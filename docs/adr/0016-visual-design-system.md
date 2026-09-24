# 0016: Visual design system and theming (Duel Arena)

## Status

Proposed — a redesign proposal for the owner's review
(`feat/redesign-duel-arena`). Becomes Accepted once it is merged.

## Context

The UI was built from raw Tailwind palette classes: roughly 365 `gray-*`
classes, 56 `bg-white` and about 70 raw status colors (`text-red-600`,
`bg-amber-50`, …) spread over ~60 files. There is no dark mode, and theming is
impossible while every component names its own gray. The look is a generic,
friendly admin UI with a violet accent; nothing about it says "trading card
game".

The owner asked for a bolder look with a Yu-Gi-Oh feel that stays modern.
Constraints that shape the answer:

- **Accessibility.** WCAG 2.1 AA text contrast in every mode, 3:1 for non-text
  UI, a visible focus indicator, the existing 44px touch targets below `lg`,
  `prefers-reduced-motion` and `forced-colors`. Nuxt UI's default status
  colors fail AA on white (red-500 3.76:1, emerald-500 about 2.5:1).
- **Privacy (GDPR).** Fonts must not load from Google or any other third-party
  host at runtime.
- **Trademarks.** No Konami logos, card-back copies, Millennium items or the
  Eye; motifs must be original.
- **Stability.** Server-rendered pages must not flash the wrong theme, and the
  E2E suite (responsive layout at 390px, hydration, 44px targets) must stay
  green.

## Decision

1. **Semantic tokens only in `app/`.** Components use Nuxt UI's semantic
   utilities (`text-highlighted`, `text-muted`, `bg-default`, `bg-elevated`,
   `border-default`, `text-error`, …) instead of palette classes. The color
   aliases are `primary: brand` (arcane violet, unchanged), `secondary:
   millennium` (gold), `neutral: abyss` (an indigo-tinted gray), plus
   `success: emerald`, `info: sky`, `warning: amber`, `error: rose`. In light
   mode the semantic variables are pinned to AA-safe shades (primary 600,
   secondary/success/info/warning 700, error 600, muted neutral-500).
   `tests/nuxt/no-raw-palette.test.ts` fails on any raw palette class in
   `app/**/*.{vue,ts}`; the few intentional ones (avatar colors, dark islands)
   sit on an allowlist with a reason, and stale allowlist entries fail too.
2. **Dark-first color mode, stored in a cookie.** `@nuxtjs/color-mode` with
   `preference: 'dark'` and `storage: 'cookie'` (`ygo-color-mode`), so the
   server renders the right `<html class>` and there is no flash. A toggle sits
   in the sidebar user block and in the auth and public headers. The
   `theme-color` meta follows the mode; the PWA manifest uses the dark canvas.
3. **Self-hosted OFL fonts through `@nuxt/fonts`** with only the `npm` provider
   enabled (all remote providers switched off): Inter (UI), Cinzel (display:
   page titles, wordmark, hero greetings) and Oxanium (numbers: counters, deck
   counts, scores). The build output must not reference Google font hosts.
4. **Shared building blocks** in `app/assets/css/main.css`: `panel` (the
   standard surface), `arena-canvas` (page background with glows and a rhombus
   lattice), `gold-hairline`, `btn-summon` (at most one hero CTA per page),
   `frame-stripe`/`frame-dot`, `card-back`, `foil`, `lp-counter` and
   `eyebrow`. Dense tools (deck editor, tables, forms) stay flat; ceremony is
   reserved for auth, dashboard, profile headers, empty states and deck tiles.
5. **Card-frame and attribute colors are decorative accents only** —
   stripes, dots and orbs next to the written type or attribute, never text
   color and never the only signal. `app/utils/card-frame.ts` maps a card's
   `frameType`/`type` to a frame key.
6. **Motion policy.** Motion is a reward: foil, fanned deck covers, tilt and
   slow ring rotations only run with `(hover: hover)` and
   `prefers-reduced-motion: no-preference` (or `motion-safe:`). Nothing
   essential depends on animation. `forced-colors: active` drops decorative
   layers and gradient text.
7. **Original motifs only**: a rhombus lattice, arcane rings, an abstract
   card back of concentric ellipses and a tilted-card brand mark.
8. **The desktop sidebar is a `.dark` island in both modes**, as are the
   auth hero pane and the dashboard/profile banners. Shadows are defined with
   `@theme inline` so they resolve against the element's own mode.
9. **Automated checks.** `e2e/a11y-axe.spec.ts` runs axe (`wcag2a`,
   `wcag2aa`, including color contrast) on the key pages in both modes;
   `e2e/color-mode.spec.ts` covers the toggle, the cookie, SSR and
   `theme-color`.

## Consequences

- New devDependencies: `@fontsource-variable/inter`,
  `@fontsource-variable/cinzel`, `@fontsource-variable/oxanium`,
  `@axe-core/playwright`.
- A migration touching most files in `app/`; test selectors that relied on
  color classes now use roles, `data-*` attributes or test ids. Class-based
  selectors are discouraged.
- Every future component must pass the palette gate and axe in both modes,
  and has to be looked at in dark and light.
- Dark is the default for new visitors; the choice is per browser (cookie),
  not per profile.

## Alternatives considered

- **"Parchment & hieroglyphs"** — kitsch, close to Millennium-item trademarks,
  weak contrast.
- **Skeuomorphic card frames on every panel** — too noisy, and it competes
  with the card scans.
- **Neon "duel disk" cyber look** — too gamey for a collection tool.
- **A light-only restyle** — misses the evening/play-mat mood and the most
  requested feature (dark mode).
- **Google-hosted fonts** — ruled out by GDPR.

## Links

- [ADR 0014](0014-ui-internationalisation.md) — every new string is in both
  catalogues.
- `pwa.config.ts` — manifest colors.
