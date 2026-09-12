<script setup lang="ts">
import { TOURNAMENT_ERROR_MESSAGES } from '~~/shared/tournaments'
import type { TournamentDetail, TournamentErrorCode, TournamentMatchDto } from '~~/shared/tournaments'
import { apiErrorCode, apiErrorMessage } from '~/utils/card-entry'

const props = defineProps<{
  match: TournamentMatchDto
  tournamentId: string
  /** Organizer, tournament running, and the match's round is still pending. */
  canEdit: boolean
  swapMode: boolean
  selectedA: boolean
  selectedB: boolean
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
  selectSlot: [slot: 'a' | 'b']
}>()

const isEditing = ref(!props.match.reported)
const gamesA = ref(props.match.gamesA)
const gamesB = ref(props.match.gamesB)
const isSubmitting = ref(false)
const errorMessage = ref('')

watch(() => props.match, (match) => {
  isEditing.value = !match.reported
  gamesA.value = match.gamesA
  gamesB.value = match.gamesB
}, { deep: true })

function errorText(error: unknown, fallback: string) {
  const code = apiErrorCode(error) as TournamentErrorCode | undefined
  return (code && TOURNAMENT_ERROR_MESSAGES[code]) || apiErrorMessage(error, fallback)
}

async function submitResult(a: number, b: number) {
  if (isSubmitting.value) {
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(
      `/api/tournaments/${props.tournamentId}/matches/${props.match.id}`,
      { method: 'PATCH', body: { gamesA: a, gamesB: b } },
    )
    isEditing.value = false
    emit('updated', detail)
  }
  catch (error) {
    errorMessage.value = errorText(error, 'Das Ergebnis konnte nicht gespeichert werden.')
  }
  finally {
    isSubmitting.value = false
  }
}

function saveForm() {
  submitResult(gamesA.value, gamesB.value)
}

const winnerName = computed(() => {
  if (props.match.winnerParticipantId === props.match.participantAId) {
    return props.match.participantAName
  }
  if (props.match.winnerParticipantId === props.match.participantBId) {
    return props.match.participantBName
  }
  return null
})

function onChipClick(slot: 'a' | 'b') {
  if (!props.swapMode) {
    return
  }
  emit('selectSlot', slot)
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs font-semibold text-gray-500">Tisch {{ match.tableNumber }}</span>

      <button
        type="button"
        class="rounded px-1 text-sm font-medium"
        :class="[
          swapMode ? 'cursor-pointer hover:bg-primary/10' : 'cursor-default',
          selectedA ? 'bg-primary/20 text-primary' : 'text-gray-900',
        ]"
        @click="onChipClick('a')"
      >
        {{ match.participantAName }}
      </button>

      <template v-if="match.isBye">
        <UBadge
          color="neutral"
          variant="subtle"
          label="Freilos"
        />
        <span class="text-xs text-gray-500">Gewertet als 2:0</span>
      </template>
      <template v-else>
        <span class="text-xs text-gray-400">vs.</span>
        <button
          type="button"
          class="rounded px-1 text-sm font-medium"
          :class="[
            swapMode ? 'cursor-pointer hover:bg-primary/10' : 'cursor-default',
            selectedB ? 'bg-primary/20 text-primary' : 'text-gray-900',
          ]"
          @click="onChipClick('b')"
        >
          {{ match.participantBName }}
        </button>
      </template>
    </div>

    <div
      v-if="!match.isBye"
      class="flex flex-wrap items-center gap-2"
    >
      <template v-if="match.reported && !isEditing">
        <span class="font-semibold tabular-nums text-gray-900">{{ match.gamesA }}:{{ match.gamesB }}</span>
        <UBadge
          variant="subtle"
          :color="match.isDraw ? 'neutral' : 'success'"
          :label="match.isDraw ? 'Unentschieden' : `Sieg ${winnerName}`"
        />
        <UButton
          v-if="canEdit"
          size="xs"
          color="neutral"
          variant="outline"
          label="Ergebnis ändern"
          @click="() => { isEditing = true }"
        />
      </template>

      <template v-else-if="canEdit">
        <UInput
          v-model.number="gamesA"
          type="number"
          min="0"
          size="xs"
          class="w-16"
          :aria-label="`Spiele ${match.participantAName}`"
        />
        <span class="text-gray-400">:</span>
        <UInput
          v-model.number="gamesB"
          type="number"
          min="0"
          size="xs"
          class="w-16"
          :aria-label="`Spiele ${match.participantBName}`"
        />
        <UButton
          size="xs"
          label="Ergebnis speichern"
          :loading="isSubmitting"
          @click="saveForm"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="2:0"
          :loading="isSubmitting"
          @click="submitResult(2, 0)"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="0:2"
          :loading="isSubmitting"
          @click="submitResult(0, 2)"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="Unentschieden"
          :loading="isSubmitting"
          @click="submitResult(1, 1)"
        />
      </template>
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-red-600"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
