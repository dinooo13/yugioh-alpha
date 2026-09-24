<script setup lang="ts">
export interface InventorySearchFilters {
  type: string[]
  attribute: string[]
  race: string[]
  level: number[]
  setId: string
  language: string[]
  condition: string[]
  edition: string[]
  sort: 'name' | '-name' | 'quantity' | 'newest'
}

interface SetOption {
  id: string
  name: string
}

interface SearchFacets {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
  sets: SetOption[]
  languages: string[]
  conditions: string[]
  editions: string[]
}

const props = defineProps<{
  facets: SearchFacets
}>()

const { t } = useI18n()
const { conditionShortLabel, editionShortLabel } = useCardOptionItems()
const { cardValueOptions } = useCardText()

const filters = defineModel<InventorySearchFilters>('filters', { required: true })

// reka-ui's <SelectItem> throws if `value` is an empty string (it's reserved
// to mean "clear selection"), so the "no selection" options use non-empty
// sentinels — matching AddToInventoryModal's `__no_printing__`/
// `__no_collection__` convention — and are mapped back to `''` via the
// computed get/set wrapper below, keeping `filters.setId` (consumed
// elsewhere as "unset" via falsy checks) unchanged.
const noSetValue = '__all_sets__'

const typeItems = computed(() => cardValueOptions('type', props.facets.types))
const attributeItems = computed(() => cardValueOptions('attribute', props.facets.attributes))
const raceItems = computed(() => cardValueOptions('race', props.facets.races))
const levelItems = computed(() => props.facets.levels.map(value => ({ label: t('card.level', { level: value }), value })))
const setItems = computed(() => [
  { label: t('inventory.search.allSets'), value: noSetValue },
  ...props.facets.sets.map(set => ({ label: set.name, value: set.id })),
])

const languageItems = computed(() => props.facets.languages.map(value => ({ label: value.toUpperCase(), value })))
const conditionItems = computed(() => props.facets.conditions.map(value => ({ label: conditionShortLabel(value), value })))
const editionItems = computed(() => props.facets.editions.map(value => ({ label: editionShortLabel(value), value })))

const setSelection = computed({
  get: () => filters.value.setId || noSetValue,
  set: (value: string) => {
    filters.value.setId = value === noSetValue ? '' : value
  },
})

const sortItems = computed(() => [
  { label: t('inventory.search.sort.nameAsc'), value: 'name' },
  { label: t('inventory.search.sort.nameDesc'), value: '-name' },
  { label: t('inventory.search.sort.quantity'), value: 'quantity' },
  { label: t('inventory.search.sort.newest'), value: 'newest' },
])

function resetFilters() {
  // Mutate the shared filters object in place (rather than reassigning
  // `filters.value`) so fields owned by the parent (q, inText, page) that
  // this panel doesn't render controls for are left untouched. The
  // collection is the page's scope (URL), not a filter — Reset keeps it.
  filters.value.type = []
  filters.value.attribute = []
  filters.value.race = []
  filters.value.level = []
  filters.value.setId = ''
  filters.value.language = []
  filters.value.condition = []
  filters.value.edition = []
  filters.value.sort = 'name'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span class="w-20 shrink-0 text-xs font-semibold uppercase text-muted">{{ t('inventory.search.catalogGroup') }}</span>
      <div class="flex flex-1 flex-wrap gap-2">
        <USelectMenu
          v-model="filters.type"
          multiple
          value-key="value"
          :items="typeItems"
          :placeholder="t('inventory.search.type')"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.attribute"
          multiple
          value-key="value"
          :items="attributeItems"
          :placeholder="t('inventory.search.attribute')"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.race"
          multiple
          value-key="value"
          :items="raceItems"
          :placeholder="t('inventory.search.race')"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.level"
          multiple
          value-key="value"
          :items="levelItems"
          :placeholder="t('inventory.search.level')"
          class="w-32"
        />
        <USelect
          v-model="setSelection"
          :items="setItems"
          :placeholder="t('inventory.search.set')"
          class="w-40"
        />
      </div>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span class="w-20 shrink-0 text-xs font-semibold uppercase text-muted">{{ t('inventory.search.ownedGroup') }}</span>
      <div class="flex flex-1 flex-wrap items-center gap-2">
        <USelectMenu
          v-model="filters.language"
          multiple
          value-key="value"
          :items="languageItems"
          :placeholder="t('card.field.printingLanguage')"
          class="w-44"
        />
        <USelectMenu
          v-model="filters.condition"
          multiple
          value-key="value"
          :items="conditionItems"
          :placeholder="t('card.field.condition')"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.edition"
          multiple
          value-key="value"
          :items="editionItems"
          :placeholder="t('card.field.edition')"
          class="w-36"
        />
        <UButton
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          :label="t('inventory.search.reset')"
          @click="resetFilters"
        />
      </div>
    </div>

    <div class="flex justify-end">
      <UFormField
        :label="t('inventory.search.sortLabel')"
        class="flex items-center gap-2"
      >
        <USelect
          v-model="filters.sort"
          :items="sortItems"
          class="w-40"
        />
      </UFormField>
    </div>
  </div>
</template>
