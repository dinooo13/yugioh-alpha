<script setup lang="ts">
export interface InventorySearchFilters {
  type: string[]
  attribute: string[]
  race: string[]
  level: number[]
  sort: 'name' | '-name' | 'quantity' | 'newest'
}

interface SearchFacets {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
}

const props = defineProps<{
  facets: SearchFacets
}>()

const { t } = useI18n()
const { cardValueOptions } = useCardText()

const filters = defineModel<InventorySearchFilters>('filters', { required: true })

const typeItems = computed(() => cardValueOptions('type', props.facets.types))
const attributeItems = computed(() => cardValueOptions('attribute', props.facets.attributes))
const raceItems = computed(() => cardValueOptions('race', props.facets.races))
const levelItems = computed(() => props.facets.levels.map(value => ({ label: t('card.level', { level: value }), value })))

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
  filters.value.sort = 'name'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <USelectMenu
        v-model="filters.type"
        multiple
        value-key="value"
        :items="typeItems"
        :placeholder="t('inventory.search.type')"
        :aria-label="t('inventory.search.type')"
        class="w-36"
      />
      <USelectMenu
        v-model="filters.attribute"
        multiple
        value-key="value"
        :items="attributeItems"
        :placeholder="t('inventory.search.attribute')"
        :aria-label="t('inventory.search.attribute')"
        class="w-36"
      />
      <USelectMenu
        v-model="filters.race"
        multiple
        value-key="value"
        :items="raceItems"
        :placeholder="t('inventory.search.race')"
        :aria-label="t('inventory.search.race')"
        class="w-36"
      />
      <USelectMenu
        v-model="filters.level"
        multiple
        value-key="value"
        :items="levelItems"
        :placeholder="t('inventory.search.level')"
        :aria-label="t('inventory.search.level')"
        class="w-32"
      />
      <UButton
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        :label="t('inventory.search.reset')"
        @click="resetFilters"
      />
    </div>

    <div class="flex justify-end">
      <UFormField
        :label="t('inventory.search.sortLabel')"
        class="flex items-center gap-2"
      >
        <USelect
          v-model="filters.sort"
          :items="sortItems"
          :aria-label="t('inventory.search.sortLabel')"
          class="w-40"
        />
      </UFormField>
    </div>
  </div>
</template>
