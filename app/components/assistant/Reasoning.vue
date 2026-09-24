<script setup lang="ts">
// The model's reasoning (ADR 0020), collapsed by default, also while it
// streams (#128): UChatReasoning opens itself when streaming starts (a
// watcher emitting update:open(true) — during its setup when it mounts
// streaming, else in the tick `streaming` turns true) and closes again after
// `autoCloseDelay`. Here `open` is controlled: those automatic opens are
// ignored, and auto-close is off, so only the user opens and closes it. The
// trigger shimmers ("Denkt nach…") while streaming.
const props = defineProps<{
  text: string
  streaming: boolean
}>()

const open = ref(false)
// True until mounted, and for the tick in which `streaming` turns true —
// exactly when UChatReasoning's automatic open arrives. A user's click never
// falls into one of these.
let ignoreOpen = true

onMounted(() => {
  ignoreOpen = false
})

watch(() => props.streaming, (streaming) => {
  if (streaming && !ignoreOpen) {
    ignoreOpen = true
    void nextTick(() => {
      ignoreOpen = false
    })
  }
}, { flush: 'sync' })

function onUpdateOpen(value: boolean) {
  if (!ignoreOpen) {
    open.value = value
  }
}
</script>

<template>
  <UChatReasoning
    :text="props.text"
    :streaming="props.streaming"
    :open="open"
    :auto-close-delay="0"
    data-testid="assistant-reasoning"
    @update:open="onUpdateOpen"
  />
</template>
