<script setup lang="ts">
import type { AssistantTimelineItem } from '~/utils/assistant-timeline'
import type { AssistantActionView } from '~~/shared/assistant-chat'

const props = defineProps<{
  timeline: AssistantTimelineItem[]
}>()

const emit = defineEmits<{
  actionUpdated: [action: AssistantActionView]
}>()

const container = ref<HTMLElement | null>(null)

// A new message/activity/action always belongs at the bottom of the
// conversation — keep it in view instead of making the user scroll after
// every reply.
watch(
  () => props.timeline.length,
  async () => {
    await nextTick()
    if (container.value) {
      container.value.scrollTop = container.value.scrollHeight
    }
  },
)
</script>

<template>
  <div
    ref="container"
    class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
  >
    <p
      v-if="timeline.length === 0"
      class="text-sm text-gray-500"
    >
      Noch keine Nachrichten — schreib dem Assistenten, was er für dich tun soll.
    </p>

    <template
      v-for="item in timeline"
      :key="item.key"
    >
      <AssistantMessageBubble
        v-if="item.type === 'message'"
        :role="item.role"
        :content="item.content"
        :attachments="item.attachments"
      />
      <AssistantToolActivity
        v-else-if="item.type === 'activity'"
        :label="item.label"
        :status="item.status"
        :summary="item.summary"
      />
      <AssistantActionCard
        v-else
        :action="item.action"
        @updated="emit('actionUpdated', $event)"
      />
    </template>
  </div>
</template>
