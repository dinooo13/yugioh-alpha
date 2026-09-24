<script setup lang="ts">
import { parseAssistantMessageBlocks } from '~/utils/assistant-message'

// A message's text with the few constructs the assistant is asked to use —
// paragraphs, `- ` lists, `**bold**` — rendered with plain interpolation,
// never `v-html` (app/utils/assistant-message.ts).
const props = defineProps<{
  text: string
}>()

const blocks = computed(() => parseAssistantMessageBlocks(props.text))
</script>

<template>
  <div class="text-sm leading-6">
    <template
      v-for="(block, blockIndex) in blocks"
      :key="blockIndex"
    >
      <p
        v-if="block.type === 'paragraph'"
        class="whitespace-pre-wrap"
        :class="{ 'mt-2': blockIndex > 0 }"
      >
        <template
          v-for="(segment, segmentIndex) in block.segments"
          :key="segmentIndex"
        >
          <strong v-if="segment.bold">{{ segment.text }}</strong>
          <template v-else>{{ segment.text }}</template>
        </template>
      </p>
      <ul
        v-else
        class="list-inside list-disc space-y-0.5"
        :class="{ 'mt-2': blockIndex > 0 }"
      >
        <li
          v-for="(item, itemIndex) in block.items"
          :key="itemIndex"
        >
          <template
            v-for="(segment, segmentIndex) in item"
            :key="segmentIndex"
          >
            <strong v-if="segment.bold">{{ segment.text }}</strong>
            <template v-else>{{ segment.text }}</template>
          </template>
        </li>
      </ul>
    </template>
  </div>
</template>
