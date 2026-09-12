<script setup lang="ts">
const props = defineProps<{
  catalogCardId: number
  inWishlist: boolean
}>()

const emit = defineEmits<{
  changed: [inWishlist: boolean]
}>()

const isSaving = ref(false)

async function toggle() {
  if (isSaving.value) {
    return
  }

  isSaving.value = true
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
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UButton
    :icon="inWishlist ? 'i-lucide-heart-off' : 'i-lucide-heart'"
    :color="inWishlist ? 'neutral' : 'primary'"
    :variant="inWishlist ? 'outline' : 'solid'"
    size="xs"
    :loading="isSaving"
    :label="inWishlist ? 'Auf der Wunschliste' : 'Zur Wunschliste'"
    @click="toggle"
  />
</template>
