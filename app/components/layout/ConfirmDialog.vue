<script setup lang="ts">
import { useConfirmDialogState } from '~/composables/useConfirm'

const { t } = useI18n()
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
  <!-- Above every other overlay: a confirm is often asked from inside one
       (the inventory's detail panel, the share dialog), and a page's modals
       are teleported after this layout-level one, so without a z-index it
       would open behind them. -->
  <UModal
    v-model:open="open"
    :title="request?.title ?? t('common.confirm')"
    :ui="{ overlay: 'z-[60]', content: 'z-[60]' }"
  >
    <template #body>
      <p class="text-sm leading-6 text-toned">
        {{ request?.description }}
      </p>

      <div class="mt-5 flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="request?.cancelLabel ?? t('common.cancel')"
          @click="resolve(false)"
        />
        <UButton
          color="error"
          :label="request?.confirmLabel ?? t('common.confirm')"
          @click="resolve(true)"
        />
      </div>
    </template>
  </UModal>
</template>
