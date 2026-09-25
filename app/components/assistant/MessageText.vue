<script setup lang="ts">
import { AssistantMarkdown, createAssistantMarkdownParser } from '~/utils/assistant-markdown'
import type { AssistantMarkdownDocument, AssistantMarkdownParser } from '~/utils/assistant-markdown'

// A message's text. The assistant's answers render as sanitized Markdown via
// Comark (app/utils/assistant-markdown.ts): an allow-list of tags, no raw
// HTML, no components, protocol-checked links, no images. The user's own
// text stays plain, exactly as typed. Never `v-html`.
//
// Parsing is async and the parser loads on the first answer (its own chunk),
// so the plain text shows until the first parse is done (also on the server),
// and while a newer parse runs the previous document stays visible. A failed
// parse (or a failed parser load) falls back to the plain text.
const props = withDefaults(defineProps<{
  text: string
  markdown?: boolean
  streaming?: boolean
}>(), {
  markdown: false,
  streaming: false,
})

const doc = shallowRef<AssistantMarkdownDocument | null>(null)
let parser: AssistantMarkdownParser | undefined
let request = 0

watch(() => [props.text, props.streaming, props.markdown] as const, ([text, streaming, markdown]) => {
  const id = ++request
  if (!markdown || import.meta.server) {
    doc.value = null
    return
  }
  parser ??= createAssistantMarkdownParser()
  parser(text, { streaming }).then(
    (result) => {
      if (id === request) {
        doc.value = result
      }
    },
    () => {
      if (id === request) {
        doc.value = null
      }
    },
  )
}, { immediate: true })
</script>

<template>
  <div class="text-sm leading-6">
    <AssistantMarkdown
      v-if="markdown && doc"
      :value="doc"
      class="min-w-0 space-y-2 wrap-break-word"
    />
    <p
      v-else
      class="whitespace-pre-wrap wrap-break-word"
    >
      {{ text }}
    </p>
  </div>
</template>
