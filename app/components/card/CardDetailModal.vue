<script setup lang="ts">
/**
 * The one card detail overlay (#88), for the catalog and the inventory.
 *
 * - Both variants: the card name as the dialog title, the type / attribute /
 *   race / level chips, the floating tilt/foil card (`CardFloatingImage`,
 *   ADR 0016), ATK/DEF and the card text in the card language, with a hint
 *   when a card has no German text (ADR 0015).
 * - `variant="catalog"` adds the English-name subtitle, the printings and
 *   the TCG/OCG release dates; `variant="inventory"` shows only the card.
 * - The caller adds its own sections through the `context` slot (before the
 *   card text: the inventory's editor is the overlay's main job there, and
 *   on phones it shouldn't sit below the whole text) and its buttons through
 *   the `actions` slot (the footer; it gets the card as
 *   `{ id, name, nameDe, type }`).
 * - The data comes from `GET /api/catalog/cards/:id`
 *   (`useCatalogCardDetail`), loaded only while the overlay is open;
 *   `preview` shows what the caller already knows while it loads.
 * - No source credit for the German texts in the UI (#87, ADR 0017).
 */
import { cardFrame } from '~/utils/card-frame'
import type { CardDetailPreview, CardDetailSummary, CardDetailVariant } from '~/utils/card-detail'
import { formatCardStat } from '~~/shared/card-stats'

const props = withDefaults(defineProps<{
  cardId: number | null
  variant?: CardDetailVariant
  preview?: CardDetailPreview | null
}>(), {
  variant: 'catalog',
  preview: null,
})

defineSlots<{
  context?: () => unknown
  actions?: (props: { card: CardDetailSummary | null }) => unknown
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { cardLocale, cardName, cardDesc, englishName, hasGermanText, cardValue } = useCardText()

// Nothing loads while the overlay is closed.
const activeId = computed(() => open.value ? props.cardId : null)
const { detail, pending, error } = useCatalogCardDetail(activeId)

const shown = computed<CardDetailPreview | null>(() => detail.value?.card ?? props.preview ?? null)
const frame = computed(() => shown.value ? cardFrame(shown.value) : null)

const imageSrc = computed(() => detail.value?.images[0]?.imageUrl
  ?? props.preview?.imageLarge
  ?? props.preview?.imageSmall
  ?? detail.value?.images[0]?.imageUrlSmall
  ?? null)

const isMonster = computed(() => Boolean(shown.value) && (shown.value!.atk !== null || shown.value!.def !== null))

const summary = computed<CardDetailSummary | null>(() => {
  if (detail.value) {
    const { id, name, nameDe, type } = detail.value.card
    return { id, name, nameDe, type }
  }
  if (props.preview && props.cardId !== null) {
    return { id: props.cardId, name: props.preview.name, nameDe: props.preview.nameDe, type: props.preview.type }
  }
  return null
})

const subtitle = computed(() => props.variant === 'catalog' && shown.value ? englishName(shown.value) : null)
const showGermanHint = computed(() => cardLocale.value === 'de' && detail.value !== null && !hasGermanText(detail.value.card))
// Wider than the default modal for the two columns. The header keeps its
// full height (a tall title/chip block must not shrink under the scrolling
// body) and leaves room for the absolutely placed close button.
const ui = { content: 'sm:max-w-3xl', header: 'shrink-0', wrapper: 'min-w-0 flex-1 pe-10' }

const hasDates = computed(() => Boolean(detail.value?.card.tcgDate || detail.value?.card.ocgDate))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="shown ? cardName(shown) : t('card.detail.fallbackTitle')"
    :ui="ui"
  >
    <!-- The description is a <p>: spans only. -->
    <template #description>
      <span
        v-if="subtitle"
        class="block"
      >{{ t('card.englishName', { name: subtitle }) }}</span>
      <span
        v-if="shown"
        class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2"
      >
        <CardTypeChip
          :type="shown.type"
          :frame-type="shown.frameType"
        />
        <CardAttributeOrb
          v-if="shown.attribute"
          :attribute="shown.attribute"
        />
        <span
          v-if="shown.race"
          class="text-xs font-medium text-toned"
        >{{ cardValue('race', shown.race) }}</span>
        <span
          v-if="shown.level"
          class="inline-flex items-center gap-1 text-xs font-medium text-toned"
        >
          <UIcon
            name="i-lucide-star"
            class="size-3.5 text-secondary"
            aria-hidden="true"
          />
          {{ t('card.level', { level: shown.level }) }}
        </span>
      </span>
    </template>

    <template #body>
      <div class="grid gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div class="space-y-4 md:sticky md:top-0 md:self-start">
          <CardFloatingImage
            v-if="shown"
            :src="imageSrc"
            :alt="cardName(shown)"
            :frame="frame?.frame"
            :pendulum="frame?.pendulum"
            class="mx-auto w-44 sm:w-52 md:w-full"
          />
          <USkeleton
            v-else
            class="mx-auto aspect-[59/86] w-44 rounded-[4.5%/3.1%] sm:w-52 md:w-full"
          />

          <dl
            v-if="shown && isMonster"
            class="flex justify-center gap-6 text-sm"
          >
            <div class="flex items-baseline gap-1.5">
              <dt class="eyebrow">
                ATK
              </dt>
              <dd class="font-numeric text-base font-bold tracking-[0.04em] text-highlighted tabular-nums">
                {{ formatCardStat(shown.atk) }}
              </dd>
            </div>
            <div class="flex items-baseline gap-1.5">
              <dt class="eyebrow">
                DEF
              </dt>
              <dd class="font-numeric text-base font-bold tracking-[0.04em] text-highlighted tabular-nums">
                {{ formatCardStat(shown.def) }}
              </dd>
            </div>
          </dl>
        </div>

        <div class="min-w-0 space-y-6">
          <slot name="context" />

          <UAlert
            v-if="error"
            color="error"
            icon="i-lucide-circle-alert"
            :title="t('card.detail.notFound')"
            :description="t('card.detail.notFoundDescription')"
          />
          <!-- Busy while the catalog detail loads; the context above is not. -->
          <section
            v-else
            :aria-busy="pending"
          >
            <h3 class="text-sm font-semibold text-highlighted">
              {{ t('card.detail.cardText') }}
            </h3>
            <p
              v-if="showGermanHint"
              class="mt-2 text-xs text-muted"
            >
              {{ t('card.germanTextMissing') }}
            </p>
            <p
              v-if="detail"
              class="mt-2 whitespace-pre-line break-words text-sm leading-6 text-default"
            >
              {{ cardDesc(detail.card) }}
            </p>
            <div
              v-else
              class="mt-2 space-y-2"
            >
              <USkeleton class="h-4 w-full" />
              <USkeleton class="h-4 w-11/12" />
              <USkeleton class="h-4 w-2/3" />
            </div>
          </section>

          <template v-if="variant === 'catalog' && detail">
            <section v-if="detail.printings.length > 0">
              <h3 class="text-sm font-semibold text-highlighted">
                {{ t('card.detail.printings') }}
              </h3>
              <ul class="mt-2 divide-y divide-default overflow-hidden rounded-lg border border-default">
                <li
                  v-for="printing in detail.printings"
                  :key="printing.setCode"
                  class="p-3 text-sm"
                >
                  <p class="font-medium break-words text-highlighted">
                    {{ printing.setName }}
                  </p>
                  <p class="mt-1 break-words text-muted">
                    {{ printing.setCode }}
                    <template v-if="printing.rarity">
                      · {{ printing.rarity }}
                    </template>
                  </p>
                </li>
              </ul>
            </section>

            <section
              v-if="hasDates"
              class="grid grid-cols-2 gap-3 text-sm text-toned"
            >
              <div v-if="detail.card.tcgDate">
                <span class="font-medium text-highlighted">TCG</span>
                <p>{{ detail.card.tcgDate }}</p>
              </div>
              <div v-if="detail.card.ocgDate">
                <span class="font-medium text-highlighted">OCG</span>
                <p>{{ detail.card.ocgDate }}</p>
              </div>
            </section>
          </template>
        </div>
      </div>
    </template>

    <template
      v-if="$slots.actions"
      #footer
    >
      <div class="flex w-full flex-wrap justify-end gap-2">
        <slot
          name="actions"
          :card="summary"
        />
      </div>
    </template>
  </UModal>
</template>
