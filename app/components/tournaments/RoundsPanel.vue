<script setup lang="ts">
import { ROUND_STATUS_LABELS, TOURNAMENT_ERROR_MESSAGES } from '~~/shared/tournaments'
import type { TournamentDetail, TournamentErrorCode, TournamentRoundDto } from '~~/shared/tournaments'
import { apiErrorCode, apiErrorMessage } from '~/utils/card-entry'

const props = defineProps<{
  tournament: TournamentDetail
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
}>()

function errorText(error: unknown, fallback: string) {
  const code = apiErrorCode(error) as TournamentErrorCode | undefined
  return (code && TOURNAMENT_ERROR_MESSAGES[code]) || apiErrorMessage(error, fallback)
}

// Rounds are shown newest first; only the current (pending) round is
// rendered expanded, everything else lives in a collapsed section.
const orderedRounds = computed(() => [...props.tournament.rounds].reverse())

function isCurrentRound(round: TournamentRoundDto): boolean {
  return props.tournament.currentRound?.id === round.id
}

function canEditRound(round: TournamentRoundDto): boolean {
  return props.tournament.role === 'organizer'
    && props.tournament.status === 'running'
    && round.status === 'pending'
}

function onMatchUpdated(detail: TournamentDetail) {
  emit('updated', detail)
}

// --- Pairing swap ------------------------------------------------------------

const swapMode = ref(false)
const swapSelection = ref<Array<{ matchId: string, slot: 'a' | 'b' }>>([])
const swapError = ref('')
const isSwapping = ref(false)

function toggleSwapMode() {
  swapMode.value = !swapMode.value
  swapSelection.value = []
  swapError.value = ''
}

function isSlotSelected(matchId: string, slot: 'a' | 'b'): boolean {
  return swapSelection.value.some(entry => entry.matchId === matchId && entry.slot === slot)
}

async function onSelectSlot(matchId: string, slot: 'a' | 'b') {
  if (isSlotSelected(matchId, slot)) {
    swapSelection.value = swapSelection.value.filter(entry => !(entry.matchId === matchId && entry.slot === slot))
    return
  }

  swapSelection.value = [...swapSelection.value, { matchId, slot }]

  if (swapSelection.value.length < 2) {
    return
  }

  const [first, second] = swapSelection.value
  swapSelection.value = []
  isSwapping.value = true
  swapError.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/matches/swap`, {
      method: 'POST',
      body: { matchAId: first!.matchId, slotA: first!.slot, matchBId: second!.matchId, slotB: second!.slot },
    })
    emit('updated', detail)
  }
  catch (error) {
    swapError.value = errorText(error, 'Diese Paarungen konnten nicht getauscht werden.')
  }
  finally {
    isSwapping.value = false
  }
}
</script>

<template>
  <section class="rounded-md border border-gray-200 bg-white p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-gray-900">
        Runden
      </h2>
      <UButton
        v-if="tournament.canEditPairings"
        size="xs"
        color="neutral"
        :variant="swapMode ? 'solid' : 'outline'"
        label="Paarungen tauschen"
        @click="toggleSwapMode"
      />
    </div>

    <p
      v-if="swapMode"
      class="mt-2 text-xs text-gray-500"
    >
      Wähle zwei Spieler, um sie zu tauschen. Sobald ein Ergebnis eingetragen ist, sind die Paarungen fix.
    </p>
    <p
      v-if="swapError"
      class="mt-2 text-sm text-red-600"
    >
      {{ swapError }}
    </p>

    <p
      v-if="orderedRounds.length === 0"
      class="mt-4 text-sm text-gray-500"
    >
      Es wurde noch keine Runde gespielt.
    </p>

    <div class="mt-4 space-y-3">
      <template
        v-for="round in orderedRounds"
        :key="round.id"
      >
        <div
          v-if="isCurrentRound(round)"
          class="space-y-2"
        >
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold text-gray-900">
              Runde {{ round.number }}
            </h3>
            <UBadge
              size="sm"
              variant="subtle"
              color="warning"
              :label="ROUND_STATUS_LABELS[round.status]"
            />
          </div>
          <TournamentsMatchRow
            v-for="match in round.matches"
            :key="match.id"
            :match="match"
            :tournament-id="tournament.id"
            :can-edit="canEditRound(round)"
            :swap-mode="swapMode && isCurrentRound(round)"
            :selected-a="isSlotSelected(match.id, 'a')"
            :selected-b="isSlotSelected(match.id, 'b')"
            @updated="onMatchUpdated"
            @select-slot="(slot) => onSelectSlot(match.id, slot)"
          />
        </div>

        <UCollapsible
          v-else
          :default-open="false"
        >
          <UButton
            color="neutral"
            variant="ghost"
            block
            class="justify-start"
            trailing-icon="i-lucide-chevron-down"
          >
            <span class="flex items-center gap-2">
              <span class="text-sm font-semibold text-gray-900">Runde {{ round.number }}</span>
              <UBadge
                size="sm"
                variant="subtle"
                color="neutral"
                :label="ROUND_STATUS_LABELS[round.status]"
              />
            </span>
          </UButton>
          <template #content>
            <div class="mt-2 space-y-2">
              <TournamentsMatchRow
                v-for="match in round.matches"
                :key="match.id"
                :match="match"
                :tournament-id="tournament.id"
                :can-edit="false"
                :swap-mode="false"
                :selected-a="false"
                :selected-b="false"
                @updated="onMatchUpdated"
              />
            </div>
          </template>
        </UCollapsible>
      </template>
    </div>
  </section>
</template>
