<script setup lang="ts">
import type { AssistantConversationListItem } from '~~/shared/assistant-chat'

const props = defineProps<{
  items: AssistantConversationListItem[]
  activeId: string | null
}>()

const emit = defineEmits<{
  created: [id: string]
  deleted: [id: string]
}>()

const { confirm } = useConfirm()
const { t } = useI18n()
const apiError = useApiError()

const isCreating = ref(false)
const deletingId = ref<string | null>(null)
const errorMessage = ref('')

async function onCreate() {
  if (isCreating.value) {
    return
  }
  isCreating.value = true
  errorMessage.value = ''
  try {
    const conversation = await $fetch<{ id: string }>('/api/assistant/chat', { method: 'POST' })
    emit('created', conversation.id)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'assistant.conversations.errors.create')
  }
  finally {
    isCreating.value = false
  }
}

async function onDelete(item: AssistantConversationListItem) {
  const confirmed = await confirm({
    title: t('assistant.conversations.confirmDelete.title'),
    description: t('assistant.conversations.confirmDelete.description', { title: item.title }),
  })
  if (!confirmed) {
    return
  }

  deletingId.value = item.id
  errorMessage.value = ''
  try {
    await $fetch(`/api/assistant/chat/${item.id}`, { method: 'DELETE' })
    emit('deleted', item.id)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'assistant.conversations.errors.delete')
  }
  finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="p-3">
      <UButton
        icon="i-lucide-plus"
        :label="t('assistant.conversations.new')"
        block
        :loading="isCreating"
        @click="onCreate"
      />
      <p
        v-if="errorMessage"
        class="mt-2 text-xs text-red-600"
      >
        {{ errorMessage }}
      </p>
    </div>

    <ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
      <li
        v-for="item in props.items"
        :key="item.id"
        class="group flex items-center"
      >
        <NuxtLink
          :to="`/assistant/${item.id}`"
          class="min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          :class="{ 'bg-gray-100 font-medium text-gray-900': item.id === props.activeId }"
        >
          {{ item.title }}
        </NuxtLink>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          class="tap-target shrink-0 opacity-0 group-hover:opacity-100"
          :aria-label="t('assistant.conversations.deleteLabel', { title: item.title })"
          :loading="deletingId === item.id"
          @click="onDelete(item)"
        />
      </li>

      <li
        v-if="props.items.length === 0"
        class="px-2.5 py-1.5 text-sm text-gray-500"
      >
        {{ t('assistant.conversations.empty') }}
      </li>
    </ul>
  </div>
</template>
