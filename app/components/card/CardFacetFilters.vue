<script setup lang="ts">
/**
 * The four card facet menus (type, attribute, race, level), shared by the
 * catalog and the inventory so both filter the same way (#63).
 *
 * - Multi-select; an empty array means "no filter".
 * - Multi-root (no wrapper): the parent's grid or flex places the menus, and
 *   `menuClass` sets their width (a multi-root component doesn't inherit `class`).
 */
export interface CardFacetOptions {
  types: string[]
  attributes: string[]
  races: string[]
  levels: number[]
}

const props = withDefaults(defineProps<{
  facets: CardFacetOptions
  /** Width classes for each menu; the parent's grid/flex places them. */
  menuClass?: string
}>(), { menuClass: 'w-full min-w-0' })

const type = defineModel<string[]>('type', { required: true })
const attribute = defineModel<string[]>('attribute', { required: true })
const race = defineModel<string[]>('race', { required: true })
const level = defineModel<number[]>('level', { required: true })

const { t } = useI18n()
const { cardValueOptions } = useCardText()

// Filter values stay English (the APIs filter on them); labels follow the card language (ADR 0015).
const typeItems = computed(() => cardValueOptions('type', props.facets.types))
const attributeItems = computed(() => cardValueOptions('attribute', props.facets.attributes))
const raceItems = computed(() => cardValueOptions('race', props.facets.races))
const levelItems = computed(() => props.facets.levels.map(value => ({ label: t('card.level', { level: value }), value })))
</script>

<template>
  <USelectMenu
    v-model="type"
    multiple
    value-key="value"
    :items="typeItems"
    :placeholder="t('card.field.type')"
    :aria-label="t('card.field.type')"
    :class="menuClass"
  />
  <USelectMenu
    v-model="attribute"
    multiple
    value-key="value"
    :items="attributeItems"
    :placeholder="t('card.field.attribute')"
    :aria-label="t('card.field.attribute')"
    :class="menuClass"
  />
  <USelectMenu
    v-model="race"
    multiple
    value-key="value"
    :items="raceItems"
    :placeholder="t('card.field.race')"
    :aria-label="t('card.field.race')"
    :class="menuClass"
  />
  <USelectMenu
    v-model="level"
    multiple
    value-key="value"
    :items="levelItems"
    :placeholder="t('card.field.level')"
    :aria-label="t('card.field.level')"
    :class="menuClass"
  />
</template>
