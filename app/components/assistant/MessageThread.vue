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
const content = ref<HTMLElement | null>(null)

// Stick to the bottom while the user is there: new rows, streamed text and
// an action card growing (e.g. "Details anzeigen") all keep the latest
// content in view. Scrolling up to reread something unpins the thread so
// nothing yanks the user back down; scrolling back near the bottom (or
// sending a message, see `stickToBottom`) pins it again.
const STICK_THRESHOLD_PX = 80
let pinned = true
let lastScrollTop = 0
let resizeObserver: ResizeObserver | null = null

function scrollToBottom() {
  const el = container.value
  if (!el) {
    return
  }
  el.scrollTop = el.scrollHeight
  lastScrollTop = el.scrollTop
}

function onScroll() {
  const el = container.value
  if (!el) {
    return
  }
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (distanceFromBottom <= STICK_THRESHOLD_PX) {
    pinned = true
  }
  else if (el.scrollTop < lastScrollTop) {
    // Only an upward scroll unpins — content growing below a pinned view
    // also moves it away from the bottom, but that's not the user leaving.
    pinned = false
  }
  lastScrollTop = el.scrollTop
}

function followIfPinned() {
  if (pinned) {
    scrollToBottom()
  }
}

/** Re-pins the thread and jumps to the bottom — the page calls this when
 * the user sends a message, so their own message and the reply are in view
 * even if they had scrolled up before. */
function stickToBottom() {
  pinned = true
  scrollToBottom()
}

onMounted(() => {
  scrollToBottom()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(followIfPinned)
    if (content.value) {
      resizeObserver.observe(content.value)
    }
    if (container.value) {
      resizeObserver.observe(container.value)
    }
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

// Every timeline update — a new row, or more streamed text on the last
// one — follows when pinned, without waiting for the resize observer.
watch(() => props.timeline, followIfPinned, { flush: 'post' })

defineExpose({ stickToBottom })
</script>

<template>
  <div
    ref="container"
    data-testid="assistant-thread"
    class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4"
    @scroll.passive="onScroll"
  >
    <div
      ref="content"
      class="space-y-3"
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
  </div>
</template>
