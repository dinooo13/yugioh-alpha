<script setup lang="ts">
/**
 * "No longer in the catalog": YGOPRODeck stopped listing a card the user
 * still references (ADR 0019). The row keeps working; the card just no
 * longer shows up in search. The hint says so on hover and focus.
 */
const { t } = useI18n()
</script>

<template>
  <UTooltip :text="t('card.retired.hint')">
    <UBadge
      color="warning"
      variant="subtle"
      size="sm"
      icon="i-lucide-archive"
      :label="t('card.retired.badge')"
      tabindex="0"
      data-testid="card-retired-badge"
      class="shrink-0"
    />
  </UTooltip>
</template>
