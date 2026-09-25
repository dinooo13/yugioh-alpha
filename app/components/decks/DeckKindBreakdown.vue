<script setup lang="ts">
/**
 * Copies per card kind in Main and Extra as chips (owner feedback in #148):
 * the deck editor's header, the shared deck view and the deck tiles (`/decks`
 * and the profile page). Kinds without copies are left out; nothing renders
 * for a deck without Main/Extra cards. Callers add their own margin.
 *
 * - Default: one labelled list per section with a short section eyebrow,
 *   the chips carry the full text ("3 Normale Monster").
 * - `compact` (tiles): one flat list, small chips with short labels
 *   ("12 Effekt"); screen readers get the full text.
 */
import type { DeckBreakdownGroup } from '~~/shared/deck-breakdown'

withDefaults(defineProps<{
  groups: DeckBreakdownGroup[]
  compact?: boolean
}>(), {
  compact: false,
})

const { t } = useI18n()
const count = useCount()
</script>

<template>
  <ul
    v-if="compact && groups.length > 0"
    class="flex min-w-0 flex-wrap gap-1"
    :aria-label="t('decks.breakdown.labelAll')"
    data-testid="deck-breakdown"
  >
    <!-- Main kinds, then Extra kinds: the two never share a kind. -->
    <template
      v-for="group in groups"
      :key="group.section"
    >
      <li
        v-for="entry in group.kinds"
        :key="`${group.section}-${entry.kind}`"
        class="inline-flex items-center gap-1 rounded-full bg-elevated/60 px-1.5 py-px text-[11px] text-default ring-1 ring-default ring-inset"
        :data-kind="entry.kind"
        :data-frame="entry.kind === 'other' ? undefined : entry.kind"
      >
        <span
          v-if="entry.kind !== 'other'"
          class="frame-dot"
          aria-hidden="true"
        />
        <span class="sr-only">{{ count(`decks.breakdown.kind.${entry.kind}`, entry.count) }}</span>
        <span
          class="tabular-nums"
          aria-hidden="true"
        >{{ entry.count }} {{ t(`decks.breakdown.short.${entry.kind}`) }}</span>
      </li>
    </template>
  </ul>

  <div
    v-else-if="groups.length > 0"
    class="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5"
    data-testid="deck-breakdown"
  >
    <div
      v-for="group in groups"
      :key="group.section"
      class="flex min-w-0 flex-wrap items-center gap-1.5"
      :data-section="group.section"
    >
      <span
        class="eyebrow"
        aria-hidden="true"
      >{{ t(`decks.sectionShort.${group.section}`) }}</span>
      <ul
        class="flex min-w-0 flex-wrap gap-1.5"
        :aria-label="t('decks.breakdown.label', { section: t(`decks.section.${group.section}`) })"
      >
        <li
          v-for="entry in group.kinds"
          :key="entry.kind"
          class="inline-flex items-center gap-1.5 rounded-full bg-elevated/60 px-2 py-0.5 text-xs text-default ring-1 ring-default ring-inset"
          :data-kind="entry.kind"
          :data-frame="entry.kind === 'other' ? undefined : entry.kind"
        >
          <span
            v-if="entry.kind !== 'other'"
            class="frame-dot"
            aria-hidden="true"
          />
          <span class="tabular-nums">{{ count(`decks.breakdown.kind.${entry.kind}`, entry.count) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
