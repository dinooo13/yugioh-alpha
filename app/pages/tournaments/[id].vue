<script setup lang="ts">
import { MIN_PARTICIPANTS_TO_START, PAIRING_SYSTEM_LABELS, TOURNAMENT_ERROR_MESSAGES, TOURNAMENT_STATUS_LABELS } from '~~/shared/tournaments'
import type { TournamentDetail, TournamentErrorCode, TournamentStatus } from '~~/shared/tournaments'
import { apiErrorCode, apiErrorMessage } from '~/utils/card-entry'

const route = useRoute()
const tournamentId = computed(() => String(route.params.id ?? ''))

const {
  data: tournament,
  pending,
  error,
} = await useFetch<TournamentDetail>(() => `/api/tournaments/${tournamentId.value}`, {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
})

useHead({ title: computed(() => `${tournament.value?.name ?? 'Turnier'} – yugioh alpha`) })

const errorMessage = ref('')
const busy = ref(false)
const { confirm } = useConfirm()

function errorText(requestError: unknown, fallback: string) {
  const code = apiErrorCode(requestError) as TournamentErrorCode | undefined
  return (code && TOURNAMENT_ERROR_MESSAGES[code]) || apiErrorMessage(requestError, fallback)
}

async function run(action: () => Promise<TournamentDetail>, fallback: string) {
  errorMessage.value = ''
  busy.value = true
  try {
    tournament.value = await action()
  }
  catch (requestError) {
    errorMessage.value = errorText(requestError, fallback)
  }
  finally {
    busy.value = false
  }
}

function onUpdated(detail: TournamentDetail) {
  tournament.value = detail
}

function startTournament() {
  return run(
    () => $fetch<TournamentDetail>(`/api/tournaments/${tournamentId.value}/start`, { method: 'POST' }),
    'Das Turnier konnte nicht gestartet werden.',
  )
}

function createNextRound() {
  return run(
    () => $fetch<TournamentDetail>(`/api/tournaments/${tournamentId.value}/rounds`, { method: 'POST' }),
    'Die nächste Runde konnte nicht erstellt werden.',
  )
}

function completeRound() {
  const roundId = tournament.value?.currentRound?.id
  if (!roundId) {
    return
  }
  return run(
    () => $fetch<TournamentDetail>(
      `/api/tournaments/${tournamentId.value}/rounds/${roundId}/complete`,
      { method: 'POST' },
    ),
    'Die Runde konnte nicht abgeschlossen werden.',
  )
}

function finishTournament() {
  return run(
    () => $fetch<TournamentDetail>(`/api/tournaments/${tournamentId.value}/finish`, { method: 'POST' }),
    'Das Turnier konnte nicht abgeschlossen werden.',
  )
}

async function onFinishClick() {
  const confirmed = await confirm({
    title: 'Turnier abschließen',
    description: 'Turnier abschließen? Ergebnisse und Paarungen können danach nicht mehr geändert werden.',
  })
  if (!confirmed) {
    return
  }
  await finishTournament()
}

async function deleteTournament() {
  if (!tournament.value) {
    return
  }
  const confirmed = await confirm({
    title: 'Turnier löschen',
    description: `"${tournament.value.name}" wirklich löschen? Alle Runden und Ergebnisse gehen verloren.`,
  })
  if (!confirmed) {
    return
  }

  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/tournaments/${tournamentId.value}`, { method: 'DELETE' })
  }
  catch (requestError) {
    errorMessage.value = errorText(requestError, 'Das Turnier konnte nicht gelöscht werden.')
    busy.value = false
    return
  }
  await navigateTo('/tournaments')
}

const STATUS_COLORS: Record<TournamentStatus, 'info' | 'warning' | 'neutral'> = {
  registration: 'info',
  running: 'warning',
  finished: 'neutral',
}

// --- Header actions (#29) ---------------------------------------------------
// Only the actions relevant to the current status are rendered at all, and
// only the one obvious next action is styled as primary — the rest are
// neutral outline buttons. Disabled buttons always carry a `title` so the
// user understands why, instead of a mute grey button.

type RunningAction = 'complete' | 'next' | 'finish'

const primaryRunningAction = computed<RunningAction>(() => {
  if (!tournament.value) {
    return 'complete'
  }
  if (tournament.value.canCreateRound) {
    return 'next'
  }
  if (tournament.value.canFinish) {
    return 'finish'
  }
  return 'complete'
})

const startTitle = computed(() => {
  if (!tournament.value || tournament.value.canStart) {
    return undefined
  }
  return `Mindestens ${MIN_PARTICIPANTS_TO_START} Teilnehmer nötig`
})

const completeRoundTitle = computed(() => {
  if (!tournament.value || tournament.value.canCompleteRound) {
    return undefined
  }
  return 'Alle Ergebnisse müssen eingetragen sein'
})

const createRoundTitle = computed(() => {
  if (!tournament.value || tournament.value.canCreateRound) {
    return undefined
  }
  if (tournament.value.currentRound) {
    return 'Schließe zuerst die laufende Runde ab'
  }
  return TOURNAMENT_ERROR_MESSAGES.planned_rounds_reached
})

const finishTitle = computed(() => {
  if (!tournament.value || tournament.value.canFinish) {
    return undefined
  }
  if (tournament.value.currentRound) {
    return TOURNAMENT_ERROR_MESSAGES.round_not_complete
  }
  if (tournament.value.rounds.length === 0) {
    return TOURNAMENT_ERROR_MESSAGES.no_rounds
  }
  return undefined
})

// A `title` tooltip never shows on touch devices, so the reason the one
// obvious next action is disabled is also spelled out under the buttons.
const actionHint = computed(() => {
  if (!tournament.value) {
    return undefined
  }
  if (tournament.value.status === 'registration') {
    return startTitle.value
  }
  if (tournament.value.status === 'running') {
    const titles: Record<RunningAction, string | undefined> = {
      complete: completeRoundTitle.value,
      next: createRoundTitle.value,
      finish: finishTitle.value,
    }
    return titles[primaryRunningAction.value]
  }
  return undefined
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <LayoutBackLink
        to="/tournaments"
        label="Zurück zu den Turnieren"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Turnier konnte nicht geladen werden"
      :description="error.message"
    />

    <div
      v-else-if="pending && !tournament"
      class="space-y-4"
    >
      <USkeleton class="h-10 w-64" />
      <USkeleton class="h-64 w-full" />
    </div>

    <template v-else-if="tournament">
      <LayoutPageHeader
        :title="tournament.name"
        :description="tournament.description ?? undefined"
        truncate
      >
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <UBadge
            :color="STATUS_COLORS[tournament.status]"
            variant="subtle"
            :label="TOURNAMENT_STATUS_LABELS[tournament.status]"
          />
          <UBadge
            v-if="tournament.format"
            color="neutral"
            variant="subtle"
            icon="i-lucide-scroll-text"
            :label="tournament.format.name"
          />
          <span
            v-else
            class="text-sm text-gray-500"
          >Ohne Format</span>
        </div>

        <dl class="mt-2 space-y-0.5 text-sm text-gray-500">
          <div>Paarungssystem: {{ PAIRING_SYSTEM_LABELS[tournament.pairingSystem] }}</div>
          <div v-if="tournament.rounds.length === 0">
            Noch nicht gestartet
          </div>
          <div v-else>
            Runde {{ tournament.rounds.length }} von {{ tournament.plannedRounds ?? '–' }}
          </div>
          <div>Turnierleitung: {{ tournament.organizerName }}</div>
        </dl>

        <template
          v-if="tournament.role === 'organizer'"
          #actions
        >
          <div class="flex flex-col gap-1.5 sm:items-end">
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              <template v-if="tournament.status === 'registration'">
                <UButton
                  label="Turnier starten"
                  color="primary"
                  :disabled="!tournament.canStart || busy"
                  :title="startTitle"
                  @click="startTournament"
                />
              </template>
              <template v-else-if="tournament.status === 'running'">
                <UButton
                  label="Runde abschließen"
                  :color="primaryRunningAction === 'complete' ? 'primary' : 'neutral'"
                  :variant="primaryRunningAction === 'complete' ? 'solid' : 'outline'"
                  :disabled="!tournament.canCompleteRound || busy"
                  :title="completeRoundTitle"
                  @click="completeRound"
                />
                <UButton
                  label="Nächste Runde"
                  :color="primaryRunningAction === 'next' ? 'primary' : 'neutral'"
                  :variant="primaryRunningAction === 'next' ? 'solid' : 'outline'"
                  :disabled="!tournament.canCreateRound || busy"
                  :title="createRoundTitle"
                  @click="createNextRound"
                />
                <UButton
                  label="Turnier abschließen"
                  :color="primaryRunningAction === 'finish' ? 'primary' : 'neutral'"
                  :variant="primaryRunningAction === 'finish' ? 'solid' : 'outline'"
                  :disabled="!tournament.canFinish || busy"
                  :title="finishTitle"
                  @click="onFinishClick"
                />
              </template>
              <UButton
                color="error"
                variant="outline"
                label="Turnier löschen"
                :disabled="busy"
                @click="deleteTournament"
              />
            </div>
            <p
              v-if="actionHint"
              class="text-xs text-gray-500"
            >
              {{ actionHint }}
            </p>
          </div>
        </template>
      </LayoutPageHeader>

      <UAlert
        v-if="tournament.status === 'finished'"
        color="neutral"
        variant="subtle"
        description="Dieses Turnier ist abgeschlossen und kann nicht mehr geändert werden."
      />
      <UAlert
        v-else-if="tournament.role === 'participant'"
        color="info"
        variant="subtle"
        description="Du nimmst an diesem Turnier teil. Änderungen nimmt die Turnierleitung vor."
      />

      <p
        v-if="errorMessage"
        class="text-sm text-red-600"
      >
        {{ errorMessage }}
      </p>

      <!-- Once finished, the final table is what people come for — lead with it. -->
      <TournamentsStandingsTable
        v-if="tournament.status === 'finished'"
        :standings="tournament.standings"
        :status="tournament.status"
      />

      <TournamentsParticipantsPanel
        :tournament="tournament"
        @updated="onUpdated"
      />

      <TournamentsRoundsPanel
        :tournament="tournament"
        @updated="onUpdated"
      />

      <TournamentsStandingsTable
        v-if="tournament.status !== 'finished'"
        :standings="tournament.standings"
        :status="tournament.status"
      />
    </template>
  </div>
</template>
