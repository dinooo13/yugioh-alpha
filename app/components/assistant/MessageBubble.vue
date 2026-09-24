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
    class="flex items-end gap-2.5"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <!-- The assistant's "arcane" avatar (decorative; the thread says who is
         speaking through the bubble's side and color). -->
    <span
      v-if="!isUser"
      class="mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-secondary/60"
      aria-hidden="true"
    >
      <UIcon
        name="i-lucide-sparkles"
        class="size-3.5"
      />
    </span>
    <div
      class="max-w-[85%] px-3.5 py-2.5 text-sm leading-6 sm:max-w-[75%]"
      :class="isUser
        ? 'rounded-2xl rounded-br-md bg-linear-to-br from-primary-500 to-primary-600 text-on-primary shadow-sm'
        : 'rounded-2xl rounded-bl-md bg-elevated text-default ring-1 ring-default'"
    >
      <ul
        v-if="attachments && attachments.length > 0"
        class="mb-1.5 flex flex-wrap gap-1"
      >
        <li
          v-for="index in attachments.length"
          :key="index"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          :class="isUser ? 'bg-on-primary/15' : 'bg-default'"
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
