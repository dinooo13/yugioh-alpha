<script setup lang="ts">
import type { WishlistItemView } from '~~/shared/sharing'
import { apiErrorMessage } from '~/utils/card-entry'

const props = defineProps<{
  item: WishlistItemView
}>()

const emit = defineEmits<{
  updated: [item: WishlistItemView]
  removed: [id: string]
}>()

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
    errorMessage.value = apiErrorMessage(error, 'Die Wunschliste konnte nicht aktualisiert werden.')
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
    errorMessage.value = apiErrorMessage(error, 'Der Eintrag konnte nicht entfernt werden.')
  }
}
</script>

<template>
  <li class="flex flex-col gap-2 px-4 py-3">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <CardThumb
        :src="item.imageSmall"
        :alt="item.name"
        size="md"
      />

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-gray-900">
          {{ item.name }}
        </p>
        <p class="text-xs text-gray-500">
          {{ item.type }}
        </p>
        <p
          v-if="item.owned !== undefined"
          class="mt-0.5 text-xs text-gray-500"
        >
          Besitz: <span class="font-semibold tabular-nums">{{ item.owned }}</span>
        </p>
        <UInput
          v-model="noteDraft"
          placeholder="Notiz (optional)"
          :aria-label="`Notiz für ${item.name}`"
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
          :aria-label="`Ein Exemplar von ${item.name} entfernen`"
          @click="setQuantity(item.quantity - 1)"
        />
        <span
          class="w-8 text-center text-sm font-semibold tabular-nums"
          :aria-label="`Anzahl von ${item.name}`"
        >
          {{ item.quantity }}
        </span>
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="xs"
          :disabled="isSaving"
          :aria-label="`Ein Exemplar von ${item.name} hinzufügen`"
          @click="setQuantity(item.quantity + 1)"
        />
      </div>

      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="xs"
        label="Entfernen"
        @click="remove"
      />
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>
  </li>
</template>
