<script setup lang="ts">
import { BYE_GAMES, MAX_GAMES_PER_MATCH } from '~~/shared/tournaments'
import type { TournamentDetail, TournamentMatchDto } from '~~/shared/tournaments'

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

const { t } = useI18n()
const apiError = useApiError()

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
    errorMessage.value = apiError(error, 'tournaments.match.saveFailed')
  }
  finally {
    isSubmitting.value = false
  }
}

/** `v-model.number` leaves a cleared input as `""`; treat that as 0 rather than posting it. */
function saveForm() {
  const a = typeof gamesA.value === 'number' ? gamesA.value : 0
  const b = typeof gamesB.value === 'number' ? gamesB.value : 0
  submitResult(a, b)
}

/**
 * A fresh, never-touched form starts at 0:0 — "Ergebnis speichern" being
 * active right away lets a stray click record a false draw and hand both
 * players a point (#33). Disable it until at least one field has moved away
 * from that starting value; the quick buttons (2:0 / 0:2 / Unentschieden)
 * remain the normal way to report a result and are never gated by this.
 */
const isUntouchedZeroZero = computed(() => {
  const a = typeof gamesA.value === 'number' ? gamesA.value : 0
  const b = typeof gamesB.value === 'number' ? gamesB.value : 0
  return a === 0 && b === 0
})

const winnerName = computed(() => {
  if (props.match.winnerParticipantId === props.match.participantAId) {
    return props.match.participantAName
  }
  if (props.match.winnerParticipantId === props.match.participantBId) {
    return props.match.participantBName
  }
  return null
})

const resultLabel = computed(() => (props.match.isDraw
  ? t('tournaments.match.draw')
  : t('tournaments.match.win', { name: winnerName.value ?? '' })))

const byeScore = computed(() => t('tournaments.match.byeScore', { score: `${BYE_GAMES}:0` }))

function onChipClick(slot: 'a' | 'b') {
  if (!props.swapMode) {
    return
  }
  emit('selectSlot', slot)
}
</script>

<template>
  <div
    data-testid="match-row"
    class="flex flex-col gap-2 rounded-md border border-default p-3 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs font-semibold text-muted">{{ t('tournaments.match.table', { number: match.tableNumber }) }}</span>

      <!-- Names are only interactive in swap mode (#35): outside of it a
           `<button>` announced no affordance and did nothing on click. -->
      <button
        v-if="swapMode"
        type="button"
        class="tap-target inline-flex cursor-pointer items-center rounded px-1 text-sm font-medium hover:bg-primary/10"
        :class="selectedA ? 'bg-primary/20 text-primary' : 'text-highlighted'"
        @click="onChipClick('a')"
      >
        {{ match.participantAName }}
      </button>
      <span
        v-else
        class="rounded px-1 text-sm font-medium text-highlighted"
      >
        {{ match.participantAName }}
      </span>

      <template v-if="match.isBye">
        <UBadge
          color="neutral"
          variant="subtle"
          :label="t('tournaments.match.bye')"
        />
        <span class="text-xs text-muted">{{ byeScore }}</span>
      </template>
      <template v-else>
        <span class="text-xs text-muted">{{ t('tournaments.match.versus') }}</span>
        <button
          v-if="swapMode"
          type="button"
          class="tap-target inline-flex cursor-pointer items-center rounded px-1 text-sm font-medium hover:bg-primary/10"
          :class="selectedB ? 'bg-primary/20 text-primary' : 'text-highlighted'"
          @click="onChipClick('b')"
        >
          {{ match.participantBName }}
        </button>
        <span
          v-else
          class="rounded px-1 text-sm font-medium text-highlighted"
        >
          {{ match.participantBName }}
        </span>
      </template>
    </div>

    <div
      v-if="!match.isBye"
      class="flex flex-wrap items-center gap-2"
    >
      <template v-if="match.reported && !isEditing">
        <span class="font-semibold tabular-nums text-highlighted">{{ match.gamesA }}:{{ match.gamesB }}</span>
        <UBadge
          variant="subtle"
          :color="match.isDraw ? 'neutral' : 'success'"
          :label="resultLabel"
        />
        <UButton
          v-if="canEdit"
          size="xs"
          color="neutral"
          variant="outline"
          :label="t('tournaments.match.editResult')"
          class="tap-target"
          @click="() => { isEditing = true }"
        />
      </template>

      <!-- Quick buttons first and primary: they are the normal path for
           reporting a result (#33). The manual score fields + save button
           come after, for the rarer best-of-3-with-games case. Two groups
           that wrap independently, so the 44px touch targets (#28) stack
           into two tidy lines on a phone instead of one ragged one. -->
      <template v-else-if="canEdit">
        <div class="flex w-full flex-wrap gap-2 sm:w-auto">
          <UButton
            size="xs"
            label="2:0"
            class="tap-target max-sm:flex-auto"
            :loading="isSubmitting"
            @click="submitResult(2, 0)"
          />
          <UButton
            size="xs"
            label="0:2"
            class="tap-target max-sm:flex-auto"
            :loading="isSubmitting"
            @click="submitResult(0, 2)"
          />
          <UButton
            size="xs"
            :label="t('tournaments.match.draw')"
            class="tap-target max-sm:flex-auto"
            :loading="isSubmitting"
            @click="submitResult(1, 1)"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model.number="gamesA"
            type="number"
            min="0"
            :max="MAX_GAMES_PER_MATCH"
            size="xs"
            class="w-16"
            :ui="{ base: 'tap-target' }"
            :aria-label="t('tournaments.match.gamesOf', { name: match.participantAName })"
          />
          <span class="text-muted">:</span>
          <UInput
            v-model.number="gamesB"
            type="number"
            min="0"
            :max="MAX_GAMES_PER_MATCH"
            size="xs"
            class="w-16"
            :ui="{ base: 'tap-target' }"
            :aria-label="t('tournaments.match.gamesOf', { name: match.participantBName ?? '' })"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :label="t('tournaments.match.saveResult')"
            class="tap-target"
            :disabled="isUntouchedZeroZero"
            :title="isUntouchedZeroZero ? t('tournaments.match.enterResultFirst') : undefined"
            :loading="isSubmitting"
            @click="saveForm"
          />
        </div>
      </template>
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
