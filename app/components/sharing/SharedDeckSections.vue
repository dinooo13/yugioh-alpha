<script setup lang="ts">
import { DECK_SECTIONS } from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'
import type { SharedDeckCardRow } from '~~/shared/sharing'

defineProps<{
  sections: Record<DeckSection, SharedDeckCardRow[]>
  counts: { main: number, extra: number, side: number, total: number }
}>()

const { t } = useI18n()
const { cardName, cardMetaLine } = useCardText()

function sectionName(section: DeckSection): string {
  return t(`decks.section.${section}`)
}
</script>

<template>
  <div class="space-y-6">
    <section
      v-for="section in DECK_SECTIONS"
      :key="section"
      class="panel overflow-hidden"
    >
      <header class="flex items-center justify-between border-b border-default px-4 py-3">
        <h2 class="text-base font-semibold text-highlighted">
          {{ sectionName(section) }}
        </h2>
        <span
          class="font-numeric text-sm font-bold tracking-[0.04em] text-muted tabular-nums"
          :aria-label="t('sharing.deckSections.countIn', { section: sectionName(section) })"
        >
          {{ counts[section] }}
        </span>
      </header>

      <p
        v-if="sections[section].length === 0"
        class="px-4 py-6 text-sm text-muted"
      >
        {{ t('sharing.deckSections.empty', { section: sectionName(section) }) }}
      </p>

      <ul
        v-else
        class="divide-y divide-default"
      >
        <li
          v-for="row in sections[section]"
          :key="`${section}-${row.catalogCardId}`"
          class="relative flex items-center gap-3 px-4 py-2"
        >
          <CardFrameStripe
            :type="row.type"
            :frame-type="row.frameType"
          />
          <CardThumb
            :src="row.imageSmall"
            :alt="cardName(row)"
            size="sm"
            :src-large="row.imageLarge"
            enlargeable
          />

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ cardName(row) }}
            </p>
            <p class="truncate text-xs text-muted">
              {{ cardMetaLine(row) }}
            </p>
            <div
              v-if="row.retired"
              class="mt-0.5"
            >
              <CardRetiredBadge audience="public" />
            </div>
          </div>

          <span class="shrink-0 font-numeric text-sm font-semibold tracking-[0.04em] text-default tabular-nums">
            {{ row.quantity }}×
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
