<script setup lang="ts">
/**
 * The "Zur Wunschliste / Auf der Wunschliste" toggle. Presentational: the
 * page owns the state and the request (`useWishlistToggle`, #98), so a
 * toggle survives the button being unmounted.
 */
withDefaults(defineProps<{
  inWishlist: boolean
  loading?: boolean
  error?: string
  size?: 'xs' | 'md'
}>(), {
  loading: false,
  error: undefined,
  size: 'xs',
})

defineEmits<{
  toggle: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="inline-flex flex-col items-start gap-1">
    <UButton
      :icon="inWishlist ? 'i-lucide-heart-off' : 'i-lucide-heart'"
      color="neutral"
      variant="outline"
      :size="size"
      :loading="loading"
      :label="inWishlist ? t('wishlist.button.onList') : t('wishlist.button.add')"
      class="tap-target"
      @click="$emit('toggle')"
    />
    <p
      v-if="error"
      class="text-xs text-error"
    >
      {{ error }}
    </p>
  </div>
</template>
