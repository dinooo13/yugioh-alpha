<script setup lang="ts">
const props = defineProps<{
  catalogCardId: number
  inWishlist: boolean
}>()

const emit = defineEmits<{
  changed: [inWishlist: boolean]
}>()

const { t } = useI18n()
const apiError = useApiError()

const isSaving = ref(false)
const errorMessage = ref('')

async function toggle() {
  if (isSaving.value) {
    return
  }

  isSaving.value = true
  errorMessage.value = ''
  try {
    if (props.inWishlist) {
      await $fetch(`/api/wishlist/card/${props.catalogCardId}`, { method: 'DELETE' })
      emit('changed', false)
    }
    else {
      await $fetch('/api/wishlist', { method: 'POST', body: { catalogCardId: props.catalogCardId } })
      emit('changed', true)
    }
  }
  catch (error) {
    errorMessage.value = apiError(error, 'wishlist.errors.updateFailed')
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="inline-flex flex-col items-start gap-1">
    <UButton
      :icon="inWishlist ? 'i-lucide-heart-off' : 'i-lucide-heart'"
      color="neutral"
      variant="outline"
      size="xs"
      :loading="isSaving"
      :label="inWishlist ? t('wishlist.button.onList') : t('wishlist.button.add')"
      class="tap-target"
      @click="toggle"
    />
    <p
      v-if="errorMessage"
      class="text-xs text-red-600"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
