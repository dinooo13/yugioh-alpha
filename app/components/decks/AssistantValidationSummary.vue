<script setup lang="ts">
import type { DeckValidation } from '~~/shared/rule-formats'

const props = withDefaults(defineProps<{
  validation: DeckValidation | null
  formatName: string | null
  title?: string
}>(), {
  title: 'Regelprüfung',
})

const badge = computed(() => {
  if (!props.formatName || !props.validation) {
    return { label: 'Kein Format gewählt', color: 'neutral' as const }
  }
  if (props.validation.legal) {
    return { label: 'Legal', color: 'success' as const }
  }
  const count = props.validation.issues.length
  return {
    label: `Nicht legal – ${count} Problem${count === 1 ? '' : 'e'}`,
    color: 'error' as const,
  }
})
</script>

<template>
  <section class="rounded-md border border-gray-200 bg-white p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-gray-900">
        {{ title }}
      </h2>
      <UBadge
        :color="badge.color"
        variant="subtle"
        :label="badge.label"
        aria-label="Regelprüfung Status"
      />
    </div>

    <p
      v-if="!formatName"
      class="mt-2 text-sm text-gray-500"
    >
      Kein Format gewählt.
    </p>
    <p
      v-else-if="validation?.legal"
      class="mt-2 text-sm text-gray-500"
    >
      Das Deck erfüllt alle Regeln von "{{ formatName }}".
    </p>
    <ul
      v-else
      class="mt-2 list-inside list-disc space-y-0.5 text-sm text-red-700"
    >
      <li
        v-for="(issue, index) in validation?.issues ?? []"
        :key="`${issue.code}-${issue.cardId ?? issue.section ?? index}`"
      >
        {{ issue.message }}
      </li>
    </ul>
  </section>
</template>
