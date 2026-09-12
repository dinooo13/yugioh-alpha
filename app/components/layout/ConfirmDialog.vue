<script setup lang="ts">
import { useConfirmDialogState } from '~/composables/useConfirm'

const request = useConfirmDialogState()

const open = computed({
  get: () => request.value !== null,
  set: (value: boolean) => {
    if (!value) {
      resolve(false)
    }
  },
})

function resolve(result: boolean) {
  request.value?.resolve(result)
  request.value = null
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="request?.title ?? 'Bestätigen'"
  >
    <template #body>
      <p class="text-sm text-gray-600">
        {{ request?.description }}
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="request?.cancelLabel ?? 'Abbrechen'"
          @click="resolve(false)"
        />
        <UButton
          color="error"
          :label="request?.confirmLabel ?? 'Bestätigen'"
          @click="resolve(true)"
        />
      </div>
    </template>
  </UModal>
</template>
