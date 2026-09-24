<script setup lang="ts">
import type { TournamentDetail, TournamentFormatRef } from '~~/shared/tournaments'
import type { DeckValidation } from '~~/shared/rule-formats'

interface DeckListItem {
  id: string
  name: string
}

interface DeckCounts { main: number, extra: number, side: number, total: number }

const props = defineProps<{
  open: boolean
  tournamentId: string
  participantId: string | null
  currentDeckId: string | null
  /** The tournament's format, if any — used for the live legality preview (#30). */
  format: TournamentFormatRef | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': [detail: TournamentDetail]
}>()

const { t, n } = useI18n()
const apiError = useApiError()
const validationText = useValidationText()

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
  { label: t('tournaments.noDeck'), value: NO_DECK },
  ...decks.value.map(deck => ({ label: deck.name, value: deck.id })),
])

// --- Live legality preview (#30) --------------------------------------------
// The deck's own `/validate` route accepts an explicit `formatId`, so the
// preview reflects the tournament's format even when it differs from the
// deck's own assigned format — not just a fallback hint.

const previewPending = ref(false)
const previewCounts = ref<DeckCounts | null>(null)
const previewValidation = ref<DeckValidation | null>(null)
/** True once a validate attempt failed (e.g. no access to a private format). */
const previewUnavailable = ref(false)
let previewToken = 0

async function loadPreview(deckId: string) {
  const token = ++previewToken
  previewPending.value = true
  previewCounts.value = null
  previewValidation.value = null
  previewUnavailable.value = false

  try {
    const deck = await $fetch<{ counts: DeckCounts }>(`/api/decks/${deckId}`)
    if (token !== previewToken) {
      return
    }
    previewCounts.value = deck.counts

    if (props.format) {
      try {
        const result = await $fetch<{ validation: DeckValidation }>(
          `/api/decks/${deckId}/validate`,
          { query: { formatId: props.format.id } },
        )
        if (token !== previewToken) {
          return
        }
        previewValidation.value = result.validation
      }
      catch {
        if (token === previewToken) {
          previewUnavailable.value = true
        }
      }
    }
  }
  catch {
    if (token === previewToken) {
      previewUnavailable.value = true
    }
  }
  finally {
    if (token === previewToken) {
      previewPending.value = false
    }
  }
}

watch(selectedDeckId, (deckId) => {
  if (deckId === NO_DECK) {
    previewToken += 1
    previewPending.value = false
    previewCounts.value = null
    previewValidation.value = null
    previewUnavailable.value = false
    return
  }
  loadPreview(deckId)
})

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

    if (selectedDeckId.value !== NO_DECK) {
      loadPreview(selectedDeckId.value)
    }
  },
  { immediate: true },
)

const previewCountsLabel = computed(() => {
  const counts = previewCounts.value
  if (!counts) {
    return ''
  }
  return t('tournaments.deckRegistration.counts', {
    count: n(counts.total, 'integer'),
    main: n(counts.main, 'integer'),
    extra: n(counts.extra, 'integer'),
    side: n(counts.side, 'integer'),
  }, counts.total)
})

const previewIssues = computed(() => previewValidation.value?.issues.map(issue => validationText(issue)) ?? [])

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
    errorMessage.value = apiError(error, 'tournaments.deckRegistration.saveFailed')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="openProxy"
    :title="t('tournaments.deckRegistration.title')"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField :label="t('tournaments.deckRegistration.deck')">
          <USelect
            v-model="selectedDeckId"
            :items="deckItems"
            :aria-label="t('tournaments.deckRegistration.deck')"
            class="w-full"
            autofocus
          />
        </UFormField>

        <div
          v-if="selectedDeckId !== NO_DECK"
          class="rounded-md border border-default bg-muted p-3 text-sm"
        >
          <template v-if="previewPending">
            <p class="text-muted">
              {{ t('tournaments.deckRegistration.checking') }}
            </p>
          </template>
          <template v-else-if="previewCounts">
            <p class="text-default">
              {{ previewCountsLabel }}
            </p>

            <div
              v-if="format && previewValidation"
              class="mt-2"
            >
              <UBadge
                size="sm"
                variant="subtle"
                :color="previewValidation.legal ? 'success' : 'error'"
                :label="previewValidation.legal ? t('validation.badge.legal') : t('validation.badge.notLegal')"
              />
              <ul
                v-if="!previewValidation.legal"
                class="mt-1 list-inside list-disc space-y-0.5 text-xs text-toned"
              >
                <li
                  v-for="(issue, index) in previewIssues"
                  :key="index"
                >
                  {{ issue }}
                </li>
              </ul>
            </div>
            <p
              v-else-if="format && previewUnavailable"
              class="mt-2 text-xs text-muted"
            >
              {{ t('tournaments.deckRegistration.checkedOnRegistration') }}
            </p>
            <p
              v-else-if="!format"
              class="mt-2 text-xs text-muted"
            >
              {{ t('tournaments.deckRegistration.noFormat') }}
            </p>
          </template>
          <p
            v-else-if="previewUnavailable"
            class="text-xs text-muted"
          >
            {{ t('tournaments.deckRegistration.checkedOnRegistration') }}
          </p>
        </div>

        <p class="text-xs text-muted">
          {{ t('tournaments.deckRegistration.copyHint') }}
        </p>

        <p
          v-if="errorMessage"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="() => { openProxy = false }"
          />
          <UButton
            :label="t('tournaments.deckRegistration.submit')"
            :loading="isSubmitting"
            @click="save"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
