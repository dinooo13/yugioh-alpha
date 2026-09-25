<script setup lang="ts">
/**
 * One row of the own wishlist: the card, the note, the quantity stepper and
 * removal. The card name is the row's button (#114): `stretched-link` makes
 * the whole row open the card overlay (`open`); the retired badge, the note
 * field, the stepper and the remove button sit above it.
 *
 * Writes are queued (`useQueuedWrites`, #148): the stepper shows the new
 * quantity at once and stays enabled (focus stays on − / +), the PATCHes go
 * out one after another, and only the last answer reaches the page. A failed
 * last write rolls back to the last confirmed item.
 */
import { MAX_WISHLIST_QUANTITY } from '~~/shared/sharing'
import type { WishlistItemView } from '~~/shared/sharing'

const props = defineProps<{
  item: WishlistItemView
}>()

const emit = defineEmits<{
  updated: [item: WishlistItemView]
  removed: [id: string]
  open: []
}>()

const { t } = useI18n()
const { cardName, cardValue } = useCardText()
const apiError = useApiError()

const noteDraft = ref(props.item.note ?? '')
watch(() => props.item.note, (value) => {
  noteDraft.value = value ?? ''
})

const errorMessage = ref('')
const writes = useQueuedWrites()
/** The quantity asked for but not yet confirmed. */
const pendingQuantity = ref<number | null>(null)
const shownQuantity = computed(() => pendingQuantity.value ?? props.item.quantity)
// The last successful answer while writes are queued.
let confirmed: WishlistItemView | null = null

async function patch(body: Record<string, unknown>) {
  errorMessage.value = ''
  const result = await writes.enqueue(() => $fetch<WishlistItemView>(`/api/wishlist/${props.item.id}`, {
    method: 'PATCH',
    body,
  }))
  if (result.ok) {
    confirmed = result.value
  }
  else {
    errorMessage.value = apiError(result.error, 'wishlist.errors.updateFailed')
  }
  if (!result.latest) {
    return
  }
  // The last success; after a failed last write this is the rollback.
  if (confirmed) {
    emit('updated', confirmed)
  }
  confirmed = null
  pendingQuantity.value = null
}

function setQuantity(quantity: number) {
  if (quantity < 1 || quantity > MAX_WISHLIST_QUANTITY) {
    return
  }
  pendingQuantity.value = quantity
  patch({ quantity })
}

function onNoteBlur() {
  const trimmed = noteDraft.value.trim()
  if (trimmed === (props.item.note ?? '')) {
    return
  }
  patch({ note: trimmed || null })
}

// Queued too, so a pending PATCH can't hit a deleted row.
async function remove() {
  errorMessage.value = ''
  const { id } = props.item
  const result = await writes.enqueue(async () => {
    await $fetch(`/api/wishlist/${id}`, { method: 'DELETE' })
  })
  if (result.ok) {
    emit('removed', id)
  }
  else {
    errorMessage.value = apiError(result.error, 'wishlist.errors.removeFailed')
  }
}
</script>

<template>
  <li class="group relative flex flex-col gap-2 px-4 py-3">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <CardThumb
        :src="item.imageSmall"
        :alt="cardName(item)"
        size="md"
      />

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <p class="min-w-0 truncate text-sm font-medium text-highlighted">
            <button
              type="button"
              aria-haspopup="dialog"
              class="stretched-link inline text-left transition-colors group-hover:text-primary after:rounded-none focus-visible:after:-outline-offset-2"
              @click="emit('open')"
            >
              {{ cardName(item) }}
            </button>
          </p>
          <div
            v-if="item.retired"
            class="relative z-10"
          >
            <CardRetiredBadge />
          </div>
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
          class="relative z-10 mt-1.5 max-w-xs"
          maxlength="200"
          @blur="onNoteBlur"
        />
      </div>

      <div class="relative z-10 shrink-0">
        <CardQuantityStepper
          :model-value="shownQuantity"
          :min="1"
          :max="MAX_WISHLIST_QUANTITY"
          size="xs"
          :input-label="t('wishlist.row.quantityOf', { name: cardName(item) })"
          :decrease-label="t('wishlist.row.decrease', { name: cardName(item) })"
          :increase-label="t('wishlist.row.increase', { name: cardName(item) })"
          @update:model-value="setQuantity"
        />
      </div>

      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="xs"
        :label="t('common.remove')"
        class="tap-target relative z-10"
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
