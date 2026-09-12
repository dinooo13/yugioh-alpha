<script setup lang="ts">
import { PAIRING_SYSTEM_LABELS, TOURNAMENT_ERROR_MESSAGES, TOURNAMENT_STATUS_LABELS } from '~~/shared/tournaments'
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

async function deleteTournament() {
  if (!tournament.value) {
    return
  }
  const confirmed = window.confirm(
    `"${tournament.value.name}" wirklich löschen? Alle Runden und Ergebnisse gehen verloren.`,
  )
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
  await navigateTo('/turniere')
}

const STATUS_COLORS: Record<TournamentStatus, 'info' | 'warning' | 'neutral'> = {
  registration: 'info',
  running: 'warning',
  finished: 'neutral',
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <NuxtLink
        to="/turniere"
        class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        Zurück zu den Turnieren
      </NuxtLink>
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
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h1 class="truncate text-2xl font-semibold text-gray-900">
            {{ tournament.name }}
          </h1>
          <p
            v-if="tournament.description"
            class="mt-1 max-w-prose text-sm text-gray-500"
          >
            {{ tournament.description }}
          </p>

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
            <div>Runde {{ tournament.rounds.length }} von {{ tournament.plannedRounds ?? '–' }}</div>
            <div>Turnierleitung: {{ tournament.organizerName }}</div>
          </dl>
        </div>

        <div
          v-if="tournament.role === 'organizer'"
          class="flex shrink-0 flex-wrap items-center gap-2"
        >
          <template v-if="tournament.status !== 'finished'">
            <UButton
              label="Turnier starten"
              :disabled="!tournament.canStart || busy"
              @click="startTournament"
            />
            <UButton
              color="neutral"
              variant="outline"
              label="Nächste Runde"
              :disabled="!tournament.canCreateRound || busy"
              @click="createNextRound"
            />
            <UButton
              color="neutral"
              variant="outline"
              label="Runde abschließen"
              :disabled="!tournament.canCompleteRound || busy"
              @click="completeRound"
            />
            <UButton
              color="neutral"
              variant="outline"
              label="Turnier abschließen"
              :disabled="!tournament.canFinish || busy"
              @click="finishTournament"
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
      </div>

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

      <TournamentsParticipantsPanel
        :tournament="tournament"
        @updated="onUpdated"
      />

      <TournamentsRoundsPanel
        :tournament="tournament"
        @updated="onUpdated"
      />

      <TournamentsStandingsTable :standings="tournament.standings" />
    </template>
  </div>
</template>
