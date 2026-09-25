<script setup lang="ts">
/**
 * The deck editor's section of the card overlay (`CardDetailModal`
 * `#context`, owner feedback in #148).
 *
 * - One row per section the card may be in (`allowedSectionsForCard`: Main
 *   and Side, or Extra and Side for Extra Deck monsters), each with the
 *   shared `CardQuantityStepper`. Going to 0 removes the card from that
 *   section without asking, as the row stepper does; the line stays, so the
 *   card can be added back from here.
 * - The page does the writes through its `setQuantity` (absolute
 *   quantities), so the list and the overlay show the same deck. The
 *   controls are disabled while a write is in flight, as in the rows.
 */
import { allowedSectionsForCard, DECK_SECTIONS, MAX_DECK_CARD_QUANTITY } from '~~/shared/deck-sections'
import type { DeckSection, DeckSectionCard } from '~~/shared/deck-sections'

const props = defineProps<{
  /** `type`/`frameType` decide the sections. */
  card: DeckSectionCard
  quantities: Record<DeckSection, number>
  owned: number
  disabled: boolean
  /** The page's last write error; the page's own error line is hidden behind the overlay. */
  error?: string
}>()

const emit = defineEmits<{ set: [section: DeckSection, quantity: number] }>()

const { t, n } = useI18n()

const sections = computed(() => allowedSectionsForCard(props.card))
// Every section, not just the allowed ones: the server makes other rows
// impossible, but the sum of everything is the honest total.
const inDeck = computed(() => DECK_SECTIONS.reduce((sum, section) => sum + props.quantities[section], 0))

function sectionName(section: DeckSection): string {
  return t(`decks.section.${section}`)
}

// Disabling the focused − / + while a write is in flight drops keyboard
// focus to <body> (Chromium), and the next Enter would do nothing. So the
// last focused control here gets focus back once the write is done — but
// only when focus really was lost, so a click elsewhere in the dialog
// during the write isn't taken over. A − that reached 0 stays disabled;
// `focus()` on it is a harmless no-op.
let lastFocused: HTMLElement | null = null

function onFocusIn(event: FocusEvent) {
  if (event.target instanceof HTMLElement) {
    lastFocused = event.target
  }
}

watch(() => props.disabled, async (now, before) => {
  if (!before || now) {
    return
  }
  await nextTick()
  const active = document.activeElement
  if ((!active || active === document.body) && lastFocused?.isConnected) {
    lastFocused.focus()
  }
})
</script>

<template>
  <section
    class="space-y-3"
    @focusin="onFocusIn"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h3 class="text-sm font-semibold text-highlighted">
        {{ t('decks.editor.overlay.title') }}
      </h3>
      <p
        class="text-xs tabular-nums"
        :class="inDeck > owned ? 'font-semibold text-error' : 'text-muted'"
      >
        {{ t('decks.editor.addPanel.ownedInDeck', { owned: n(owned, 'integer'), inDeck: n(inDeck, 'integer') }) }}
      </p>
    </div>

    <p
      v-if="error"
      role="alert"
      class="text-sm text-error"
    >
      {{ error }}
    </p>

    <ul class="space-y-2">
      <li
        v-for="section in sections"
        :key="section"
        class="flex items-center justify-between gap-3 rounded-lg border border-default bg-elevated/40 p-3"
        :data-section="section"
      >
        <span class="text-sm font-medium text-highlighted">{{ sectionName(section) }}</span>
        <CardQuantityStepper
          :model-value="quantities[section]"
          :min="0"
          :max="MAX_DECK_CARD_QUANTITY"
          size="sm"
          :disabled="disabled"
          :input-label="t('decks.editor.overlay.quantity', { section: sectionName(section) })"
          :decrease-label="t('decks.editor.overlay.decrease', { section: sectionName(section) })"
          :increase-label="t('decks.editor.overlay.increase', { section: sectionName(section) })"
          @update:model-value="(value: number) => emit('set', section, value)"
        />
      </li>
    </ul>
  </section>
</template>
