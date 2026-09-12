<script setup lang="ts">
import type { AssistantActivityStatus } from '~/utils/assistant-timeline'

withDefaults(defineProps<{
  label: string
  status: AssistantActivityStatus
  summary?: string
}>(), {
  summary: undefined,
})
</script>

<template>
  <div class="flex justify-start">
    <div
      class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      :class="status === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-gray-200 bg-gray-50 text-gray-600'"
    >
      <UIcon
        v-if="status === 'running'"
        name="i-lucide-loader-circle"
        class="size-3.5 shrink-0 animate-spin"
      />
      <UIcon
        v-else-if="status === 'error'"
        name="i-lucide-circle-x"
        class="size-3.5 shrink-0"
      />
      <UIcon
        v-else
        name="i-lucide-circle-check"
        class="size-3.5 shrink-0"
      />
      <span class="truncate">{{ label }}</span>
      <span
        v-if="summary && status !== 'running'"
        class="truncate text-gray-400"
      >— {{ summary }}</span>
    </div>
  </div>
</template>
