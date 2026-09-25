<script setup lang="ts">
/**
 * "No longer in the catalog": YGOPRODeck stopped listing a card the user
 * still references (ADR 0019). The row keeps working; the card just no
 * longer shows up in search. The hint opens on click/tap (#107), so it works
 * on phones too.
 *
 * `audience="public"` (shared views) drops "your entries stay" from the hint.
 * The trigger sits above `stretched-link` overlays (`relative z-10`), so a
 * tap opens the hint instead of the row's card overlay.
 */
const props = withDefaults(defineProps<{ audience?: 'owner' | 'public' }>(), { audience: 'owner' })
const { t } = useI18n()

const hint = computed(() => props.audience === 'public' ? t('card.retired.hintPublic') : t('card.retired.hint'))
</script>

<template>
  <UPopover :content="{ side: 'top', align: 'start' }">
    <button
      type="button"
      data-testid="card-retired-badge"
      class="relative z-10 inline-flex shrink-0 rounded-md"
    >
      <UBadge
        color="warning"
        variant="subtle"
        size="sm"
        icon="i-lucide-archive"
        :label="t('card.retired.badge')"
      />
    </button>

    <template #content>
      <p
        class="max-w-64 p-3 text-sm text-default"
        data-testid="card-retired-hint"
      >
        {{ hint }}
      </p>
    </template>
  </UPopover>
</template>
