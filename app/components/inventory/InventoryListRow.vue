<script setup lang="ts">
interface InventoryListItem {
  id: string
  collectionId: string | null
  quantity: number
  language: string
  condition: string
  edition: string
  cardName: string
  /** Official German name (ADR 0015); null when there is none. */
  cardNameDe?: string | null
  cardType: string
  imageUrlSmall: string | null
  setName: string | null
  rarity: string | null
}

const props = defineProps<{
  item: InventoryListItem
  assignItems: Array<{ label: string, value: string }>
  noAssignmentValue: string
}>()

const emit = defineEmits<{
  assign: [value: string]
  edit: []
  remove: []
}>()

const { t } = useI18n()
const { cardName, cardValue } = useCardText()
const displayName = computed(() => cardName({ name: props.item.cardName, nameDe: props.item.cardNameDe }))
const { editionShortLabel, conditionShortLabel } = useCardOptionItems()

const editionLabel = computed(() => editionShortLabel(props.item.edition))
const conditionLabel = computed(() => conditionShortLabel(props.item.condition))
const languageLabel = computed(() => props.item.language.toUpperCase())
</script>

<template>
  <!-- One markup for every width: stacked on phones, a single row from `sm`
       up. No column header — each attribute is a labelled badge instead. -->
  <li class="flex gap-3 px-4 py-3 sm:items-center">
    <CardThumb
      :src="item.imageUrlSmall"
      :alt="displayName"
      size="lg"
      class="sm:w-12"
    />

    <div class="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div class="min-w-0 flex-1 space-y-1">
        <div class="line-clamp-2 text-sm font-medium text-gray-900 sm:truncate">
          {{ displayName }}
        </div>
        <div class="truncate text-xs text-gray-500">
          {{ cardValue('type', item.cardType) }}<span v-if="item.setName"> · {{ item.setName }}</span><span v-if="item.rarity"> · {{ item.rarity }}</span>
        </div>
        <div class="flex flex-wrap gap-1">
          <UBadge
            size="sm"
            color="neutral"
            variant="soft"
            :title="t('inventory.row.fieldValue', { field: t('card.field.printingLanguage'), value: languageLabel })"
          >
            <span class="sr-only">{{ t('card.field.printingLanguage') }} </span>{{ languageLabel }}
          </UBadge>
          <UBadge
            size="sm"
            color="neutral"
            variant="soft"
            :title="t('inventory.row.fieldValue', { field: t('card.field.edition'), value: editionLabel })"
          >
            <span class="sr-only">{{ t('card.field.edition') }} </span>{{ editionLabel }}
          </UBadge>
          <UBadge
            size="sm"
            color="neutral"
            variant="soft"
            :title="t('inventory.row.fieldValue', { field: t('card.field.condition'), value: conditionLabel })"
          >
            <span class="sr-only">{{ t('card.field.condition') }} </span>{{ conditionLabel }}
          </UBadge>
        </div>
      </div>

      <div class="flex min-w-0 items-center gap-2">
        <span class="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">
          ×{{ item.quantity }}
        </span>
        <USelect
          :model-value="item.collectionId ?? noAssignmentValue"
          :items="assignItems"
          :aria-label="t('inventory.row.collectionFor', { name: displayName })"
          class="min-w-0 flex-1 sm:w-44 sm:flex-none"
          @update:model-value="(value: string) => emit('assign', value)"
        />
        <div class="flex shrink-0 gap-1">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            :aria-label="t('inventory.row.edit')"
            @click="emit('edit')"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            :aria-label="t('inventory.row.remove')"
            @click="emit('remove')"
          />
        </div>
      </div>
    </div>
  </li>
</template>
