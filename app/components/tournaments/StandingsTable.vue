<script setup lang="ts">
import { formatRate } from '~~/shared/tournaments'
import type { TournamentStandingRow, TournamentStatus } from '~~/shared/tournaments'

const props = defineProps<{
  standings: TournamentStandingRow[]
  status: TournamentStatus
}>()

function recordLabel(row: TournamentStandingRow): string {
  return `${row.wins}-${row.losses}-${row.draws}`
}

// The first-ranked row of a finished tournament, i.e. the winner (#36). Rank
// 1 while still running is just the current leader, not a final result, so
// the trophy/"Sieger" treatment is finished-only.
const winner = computed(() => {
  if (props.status !== 'finished') {
    return null
  }
  return props.standings.find(row => row.rank === 1) ?? null
})
</script>

<template>
  <section class="rounded-md border border-gray-200 bg-white p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-gray-900">
        Tabelle
      </h2>
      <p
        v-if="winner"
        class="flex items-center gap-1.5 text-sm font-semibold text-amber-600"
      >
        <UIcon
          name="i-lucide-trophy"
          class="size-4"
        />
        Sieger: {{ winner.name }}
      </p>
    </div>

    <p
      v-if="standings.length === 0"
      class="mt-4 text-sm text-gray-500"
    >
      Noch keine Ergebnisse.
    </p>

    <div
      v-else
      class="mt-4 overflow-x-auto"
    >
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
            <th class="py-2 pr-2">
              Platz
            </th>
            <th class="px-2 py-2">
              Spieler
            </th>
            <th class="px-2 py-2">
              Punkte
            </th>
            <th class="px-2 py-2">
              S-N-U
            </th>
            <th class="px-2 py-2">
              OMW%
            </th>
            <th class="px-2 py-2">
              GW%
            </th>
            <th class="px-2 py-2">
              OGW%
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="row in standings"
            :key="row.participantId"
            :class="row.rank === 1 ? 'bg-amber-50' : undefined"
          >
            <td class="py-2 pr-2 tabular-nums text-gray-500">
              <span class="inline-flex items-center gap-1">
                <UIcon
                  v-if="row.rank === 1"
                  name="i-lucide-trophy"
                  class="size-3.5 text-amber-500"
                />
                {{ row.rank }}
              </span>
            </td>
            <td
              class="px-2 py-2 font-medium"
              :class="row.rank === 1 ? 'text-amber-900' : 'text-gray-900'"
            >
              {{ row.name }}
              <UBadge
                v-if="row.dropped"
                size="sm"
                class="ml-1"
                color="neutral"
                variant="subtle"
                label="Ausgestiegen"
              />
            </td>
            <td class="px-2 py-2 tabular-nums">
              {{ row.points }}
            </td>
            <td class="px-2 py-2 tabular-nums">
              {{ recordLabel(row) }}
            </td>
            <td class="px-2 py-2 tabular-nums">
              {{ formatRate(row.opponentMatchWinRate) }}
            </td>
            <td class="px-2 py-2 tabular-nums">
              {{ formatRate(row.gameWinRate) }}
            </td>
            <td class="px-2 py-2 tabular-nums">
              {{ formatRate(row.opponentGameWinRate) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-3 text-xs text-gray-400">
      OMW% = Siegquote der Gegner, GW% = eigene Spielquote, OGW% = Spielquote der Gegner.
    </p>
  </section>
</template>
