<script setup lang="ts">
import { DECK_SECTIONS } from '~~/shared/deck-sections'
import type { DeckSection } from '~~/shared/deck-sections'
import type { SharedDeckCardRow } from '~~/shared/sharing'

defineProps<{
  sections: Record<DeckSection, SharedDeckCardRow[]>
  counts: { main: number, extra: number, side: number, total: number }
}>()

const { t } = useI18n()
const { cardName, cardValue } = useCardText()

function sectionName(section: DeckSection): string {
  return t(`decks.section.${section}`)
}

function cardMetaLine(card: SharedDeckCardRow): string {
  return [cardValue('type', card.type), card.level !== null ? t('card.stars', { level: card.level }) : null, card.attribute ? cardValue('attribute', card.attribute) : null]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <div class="space-y-6">
    <section
      v-for="section in DECK_SECTIONS"
      :key="section"
      class="rounded-md border border-gray-200 bg-white"
    >
      <header class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 class="text-base font-semibold text-gray-900">
          {{ sectionName(section) }}
        </h2>
        <span
          class="text-sm font-semibold tabular-nums text-gray-500"
          :aria-label="t('sharing.deckSections.countIn', { section: sectionName(section) })"
        >
          {{ counts[section] }}
        </span>
      </header>

      <p
        v-if="sections[section].length === 0"
        class="px-4 py-6 text-sm text-gray-500"
      >
        {{ t('sharing.deckSections.empty', { section: sectionName(section) }) }}
      </p>

      <ul
        v-else
        class="divide-y divide-gray-100"
      >
        <li
          v-for="row in sections[section]"
          :key="`${section}-${row.catalogCardId}`"
          class="flex items-center gap-3 px-4 py-2"
        >
          <CardThumb
            :src="row.imageSmall"
            :alt="cardName(row)"
            size="sm"
            :src-large="row.imageLarge"
            enlargeable
          />

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-gray-900">
              {{ cardName(row) }}
            </p>
            <p class="truncate text-xs text-gray-500">
              {{ cardMetaLine(row) }}
            </p>
          </div>

          <span class="shrink-0 text-sm font-semibold tabular-nums text-gray-700">
            {{ row.quantity }}×
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
