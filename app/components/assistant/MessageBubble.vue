<script setup lang="ts">
import { parseAssistantMessageBlocks } from '~/utils/assistant-message'
import type { AssistantAttachment } from '~~/shared/assistant-chat'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  attachments?: AssistantAttachment[]
}>()

const { t } = useI18n()

const blocks = computed(() => parseAssistantMessageBlocks(props.content))
const isUser = computed(() => props.role === 'user')
</script>

<template>
  <div
    class="flex"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <div
      class="max-w-[85%] rounded-lg px-3 py-2 text-sm sm:max-w-[75%]"
      :class="isUser ? 'bg-primary text-white' : 'bg-gray-100 text-gray-900'"
    >
      <ul
        v-if="attachments && attachments.length > 0"
        class="mb-1.5 flex flex-wrap gap-1"
      >
        <li
          v-for="index in attachments.length"
          :key="index"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          :class="isUser ? 'bg-white/20' : 'bg-white'"
        >
          <UIcon
            name="i-lucide-image"
            class="size-3"
          />
          {{ t('assistant.thread.photo', { index }) }}
        </li>
      </ul>

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
  </div>
</template>
