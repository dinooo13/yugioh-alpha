<script setup lang="ts">
import type { AssistantToolOutcome } from '~~/shared/assistant-chat'
import type { AssistantActivityStatus } from '~/utils/assistant-timeline'
import { toolCallLabel, toolOutcomeSummary } from '~/utils/assistant-tool-activity'
import type { ToolActivityCall } from '~/utils/assistant-tool-activity'

const props = withDefaults(defineProps<{
  call: ToolActivityCall
  status: AssistantActivityStatus
  outcome?: AssistantToolOutcome
}>(), {
  outcome: undefined,
})

const { t, n } = useI18n()

const label = computed(() => toolCallLabel(t, props.call))
const summary = computed(() => props.status === 'running' || !props.outcome
  ? null
  : toolOutcomeSummary(t, props.status !== 'error', props.outcome, count => n(count, 'integer')))
// A failed tool shows "failed"; the raw (technical, English) error the
// model got is only in the tooltip.
const errorDetail = computed(() => props.status === 'error' ? props.outcome?.error : undefined)
</script>

<template>
  <div class="flex justify-start ps-[2.375rem]">
    <div
      class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      :class="status === 'error'
        ? 'border-error/30 bg-error/10 text-error'
        : 'border-default bg-muted text-toned'"
      :title="errorDetail"
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
        v-if="summary"
        class="truncate text-muted"
      >— {{ summary }}</span>
    </div>
  </div>
</template>
