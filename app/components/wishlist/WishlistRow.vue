<script setup lang="ts">
import type { WishlistItemView } from '~~/shared/sharing'

const props = defineProps<{
  item: WishlistItemView
}>()

const emit = defineEmits<{
  updated: [item: WishlistItemView]
  removed: [id: string]
}>()

const { t } = useI18n()
const { cardName, cardValue } = useCardText()
const apiError = useApiError()

const noteDraft = ref(props.item.note ?? '')
watch(() => props.item.note, (value) => {
  noteDraft.value = value ?? ''
})

const isSaving = ref(false)
const errorMessage = ref('')

async function patch(body: Record<string, unknown>) {
  isSaving.value = true
  errorMessage.value = ''
  try {
    const updated = await $fetch<WishlistItemView>(`/api/wishlist/${props.item.id}`, {
      method: 'PATCH',
      body,
    })
    emit('updated', updated)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'wishlist.errors.updateFailed')
  }
  finally {
    isSaving.value = false
  }
}

function setQuantity(quantity: number) {
  if (quantity < 1 || quantity > 99 || isSaving.value) {
    return
  }
  patch({ quantity })
}

function onNoteBlur() {
  const trimmed = noteDraft.value.trim()
  if (trimmed === (props.item.note ?? '')) {
    return
  }
  patch({ note: trimmed || null })
}

async function remove() {
  errorMessage.value = ''
  try {
    await $fetch(`/api/wishlist/${props.item.id}`, { method: 'DELETE' })
    emit('removed', props.item.id)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'wishlist.errors.removeFailed')
  }
}
</script>

<template>
  <li class="flex flex-col gap-2 px-4 py-3">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <CardThumb
        :src="item.imageSmall"
        :alt="cardName(item)"
        size="md"
      />

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <p class="min-w-0 truncate text-sm font-medium text-highlighted">
            {{ cardName(item) }}
          </p>
          <CardRetiredBadge v-if="item.retired" />
        </div>
        <p class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <CardFrameDot :type="item.type" />
          <span class="truncate">{{ cardValue('type', item.type) }}</span>
        </p>
        <p
          v-if="item.owned !== undefined"
          class="mt-0.5 text-xs text-muted"
        >
          <i18n-t
            keypath="wishlist.row.owned"
            scope="global"
          >
            <template #count>
              <span class="font-semibold tabular-nums">{{ item.owned }}</span>
            </template>
          </i18n-t>
        </p>
        <UInput
          v-model="noteDraft"
          :placeholder="t('wishlist.row.notePlaceholder')"
          :aria-label="t('wishlist.row.noteFor', { name: cardName(item) })"
          class="mt-1.5 max-w-xs"
          maxlength="200"
          @blur="onNoteBlur"
        />
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <UButton
          icon="i-lucide-minus"
          color="neutral"
          variant="outline"
          size="xs"
          :disabled="isSaving || item.quantity <= 1"
          :aria-label="t('wishlist.row.decrease', { name: cardName(item) })"
          class="tap-target"
          @click="setQuantity(item.quantity - 1)"
        />
        <span
          class="w-8 text-center text-sm font-semibold tabular-nums"
          :aria-label="t('wishlist.row.quantityOf', { name: cardName(item) })"
        >
          {{ item.quantity }}
        </span>
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="xs"
          :disabled="isSaving"
          :aria-label="t('wishlist.row.increase', { name: cardName(item) })"
          class="tap-target"
          @click="setQuantity(item.quantity + 1)"
        />
      </div>

      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="xs"
        :label="t('common.remove')"
        class="tap-target"
        @click="remove"
      />
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>
  </li>
</template>
