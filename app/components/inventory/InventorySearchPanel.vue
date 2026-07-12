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
  collectionId: string
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

interface CollectionOption {
  id: string
  name: string
  cardCount: number
}

const props = defineProps<{
  facets: SearchFacets
  collections: CollectionOption[]
  editionLabels: Record<string, string>
  conditionLabels: Record<string, string>
}>()

const filters = defineModel<InventorySearchFilters>('filters', { required: true })

// reka-ui's <SelectItem> throws if `value` is an empty string (it's reserved
// to mean "clear selection"), so the "no selection" options use non-empty
// sentinels — matching AddToInventoryModal's `__no_printing__`/
// `__no_collection__` convention — and are mapped back to `''` via the
// computed get/set wrappers below, keeping `filters.setId`/`collectionId`
// (consumed elsewhere as "unset" via falsy checks) unchanged.
const noSetValue = '__all_sets__'
const noCollectionValue = '__all_collections__'
const unassignedCollectionValue = '__none__'

const typeItems = computed(() => props.facets.types.map(value => ({ label: value, value })))
const attributeItems = computed(() => props.facets.attributes.map(value => ({ label: value, value })))
const raceItems = computed(() => props.facets.races.map(value => ({ label: value, value })))
const levelItems = computed(() => props.facets.levels.map(value => ({ label: `Level ${value}`, value })))
const setItems = computed(() => [
  { label: 'Alle Sets', value: noSetValue },
  ...props.facets.sets.map(set => ({ label: set.name, value: set.id })),
])

const languageItems = computed(() => props.facets.languages.map(value => ({ label: value.toUpperCase(), value })))
const conditionItems = computed(() => props.facets.conditions.map(value => ({ label: props.conditionLabels[value] ?? value, value })))
const editionItems = computed(() => props.facets.editions.map(value => ({ label: props.editionLabels[value] ?? value, value })))
const collectionItems = computed(() => [
  { label: 'Alle Sammlungen', value: noCollectionValue },
  { label: '(keine Sammlung)', value: unassignedCollectionValue },
  ...props.collections.map(collection => ({ label: `${collection.name} (${collection.cardCount})`, value: collection.id })),
])

const setSelection = computed({
  get: () => filters.value.setId || noSetValue,
  set: (value: string) => {
    filters.value.setId = value === noSetValue ? '' : value
  },
})

const collectionSelection = computed({
  get: () => filters.value.collectionId || noCollectionValue,
  set: (value: string) => {
    filters.value.collectionId = value === noCollectionValue ? '' : value
  },
})

const sortItems = [
  { label: 'Name (A-Z)', value: 'name' },
  { label: 'Name (Z-A)', value: '-name' },
  { label: 'Anzahl', value: 'quantity' },
  { label: 'Neueste', value: 'newest' },
]

function resetFilters() {
  // Mutate the shared filters object in place (rather than reassigning
  // `filters.value`) so fields owned by the parent (q, inText, page) that
  // this panel doesn't render controls for are left untouched.
  filters.value.type = []
  filters.value.attribute = []
  filters.value.race = []
  filters.value.level = []
  filters.value.setId = ''
  filters.value.language = []
  filters.value.condition = []
  filters.value.edition = []
  filters.value.collectionId = ''
  filters.value.sort = 'name'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span class="w-20 shrink-0 text-xs font-semibold uppercase text-gray-500">Katalog</span>
      <div class="flex flex-1 flex-wrap gap-2">
        <USelectMenu
          v-model="filters.type"
          multiple
          value-key="value"
          :items="typeItems"
          placeholder="Typ"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.attribute"
          multiple
          value-key="value"
          :items="attributeItems"
          placeholder="Attribut"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.race"
          multiple
          value-key="value"
          :items="raceItems"
          placeholder="Rasse"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.level"
          multiple
          value-key="value"
          :items="levelItems"
          placeholder="Level"
          class="w-32"
        />
        <USelect
          v-model="setSelection"
          :items="setItems"
          placeholder="Set"
          class="w-40"
        />
      </div>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span class="w-20 shrink-0 text-xs font-semibold uppercase text-gray-500">Besitz</span>
      <div class="flex flex-1 flex-wrap items-center gap-2">
        <USelectMenu
          v-model="filters.language"
          multiple
          value-key="value"
          :items="languageItems"
          placeholder="Sprache"
          class="w-32"
        />
        <USelectMenu
          v-model="filters.condition"
          multiple
          value-key="value"
          :items="conditionItems"
          placeholder="Zustand"
          class="w-36"
        />
        <USelectMenu
          v-model="filters.edition"
          multiple
          value-key="value"
          :items="editionItems"
          placeholder="Auflage"
          class="w-36"
        />
        <USelect
          v-model="collectionSelection"
          :items="collectionItems"
          placeholder="Sammlung"
          class="w-48"
        />
        <UButton
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          label="Reset"
          @click="resetFilters"
        />
      </div>
    </div>

    <div class="flex justify-end">
      <UFormField
        label="Sortierung"
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
