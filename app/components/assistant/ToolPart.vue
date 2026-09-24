<script setup lang="ts">
import { toolCallLabel, toolOutcomeSummary, toolPartCall, toolPartOutcome } from '~/utils/assistant-tool-activity'
import type { AssistantToolPartLike } from '~/utils/assistant-tool-activity'

// One tool call of an answer as a chip (ADR 0014/0020): what the assistant
// does ("Sucht im Katalog: Dark Magician", with the deck's name instead of
// its id, #53, and the card's name — in the card language — instead of its
// id once `get_card` is done, #128), shimmering while it runs, then its
// outcome. A failed call
// opens to show the (technical, English) error the model got.
const props = defineProps<{
  part: AssistantToolPartLike
}>()

const { t, n } = useI18n()
const { cardName } = useCardText()

const call = computed(() => toolPartCall(props.part, cardName))
const result = computed(() => toolPartOutcome(props.part))
const isRunning = computed(() => result.value.state === 'running')
const isFailed = computed(() => result.value.state === 'error')

const label = computed(() => toolCallLabel(t, call.value))
const summary = computed(() => isRunning.value || !result.value.outcome
  ? undefined
  : `— ${toolOutcomeSummary(t, !isFailed.value, result.value.outcome, count => n(count, 'integer'))}`)
const errorDetail = computed(() => isFailed.value ? result.value.outcome?.error || undefined : undefined)
</script>

<template>
  <UChatTool
    :text="label"
    :suffix="summary"
    :icon="isFailed ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
    :loading="isRunning"
    loading-icon="i-lucide-loader-circle"
    :streaming="isRunning"
    :ui="isFailed ? { trigger: 'text-error hover:text-error disabled:hover:text-error', suffix: 'text-error' } : undefined"
    data-testid="assistant-tool"
    :data-outcome="result.state"
  >
    <template
      v-if="errorDetail"
      #default
    >
      <p class="break-words">
        {{ errorDetail }}
      </p>
    </template>
  </UChatTool>
</template>
