<script setup lang="ts">
import { TOURNAMENT_ERROR_MESSAGES } from '~~/shared/tournaments'
import type { TournamentDetail, TournamentErrorCode } from '~~/shared/tournaments'
import { apiErrorCode, apiErrorMessage } from '~/utils/card-entry'

interface DeckListItem {
  id: string
  name: string
}

const props = defineProps<{
  open: boolean
  tournamentId: string
  participantId: string | null
  currentDeckId: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': [detail: TournamentDetail]
}>()

// Sentinel for "no deck" in the select — reka-ui reserves the empty string
// for "clear selection".
const NO_DECK = '__no_deck__'

const openProxy = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const selectedDeckId = ref(NO_DECK)
const isSubmitting = ref(false)
const errorMessage = ref('')
const decks = ref<DeckListItem[]>([])

const deckItems = computed(() => [
  { label: 'Kein Deck', value: NO_DECK },
  ...decks.value.map(deck => ({ label: deck.name, value: deck.id })),
])

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      return
    }
    errorMessage.value = ''
    selectedDeckId.value = props.currentDeckId ?? NO_DECK

    try {
      const response = await $fetch<{ items: DeckListItem[] }>('/api/decks', { query: { pageSize: 100 } })
      decks.value = response.items
    }
    catch {
      decks.value = []
    }
  },
  { immediate: true },
)

function errorText(error: unknown, fallback: string) {
  const code = apiErrorCode(error) as TournamentErrorCode | undefined
  return (code && TOURNAMENT_ERROR_MESSAGES[code]) || apiErrorMessage(error, fallback)
}

async function save() {
  if (!props.participantId || isSubmitting.value) {
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(
      `/api/tournaments/${props.tournamentId}/participants/${props.participantId}/deck`,
      {
        method: 'PUT',
        body: { deckId: selectedDeckId.value === NO_DECK ? null : selectedDeckId.value },
      },
    )
    emit('updated', detail)
    openProxy.value = false
  }
  catch (error) {
    errorMessage.value = errorText(error, 'Das Deck konnte nicht angemeldet werden.')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="openProxy"
    title="Deck anmelden"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Deck">
          <USelect
            v-model="selectedDeckId"
            :items="deckItems"
            aria-label="Deck"
            class="w-full"
          />
        </UFormField>

        <p class="text-xs text-gray-500">
          Dein Deck wird beim Anmelden kopiert. Spätere Änderungen am Deck ändern das Turnier nicht.
        </p>

        <p
          v-if="errorMessage"
          class="text-sm text-red-600"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            label="Abbrechen"
            @click="() => { openProxy = false }"
          />
          <UButton
            label="Anmelden"
            :loading="isSubmitting"
            @click="save"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
