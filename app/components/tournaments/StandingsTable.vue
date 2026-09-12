<script setup lang="ts">
import { formatRate } from '~~/shared/tournaments'
import type { TournamentStandingRow } from '~~/shared/tournaments'

defineProps<{
  standings: TournamentStandingRow[]
}>()

function recordLabel(row: TournamentStandingRow): string {
  return `${row.wins}-${row.losses}-${row.draws}`
}
</script>

<template>
  <section class="rounded-md border border-gray-200 bg-white p-4">
    <h2 class="text-base font-semibold text-gray-900">
      Tabelle
    </h2>

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
          >
            <td class="py-2 pr-2 tabular-nums text-gray-500">
              {{ row.rank }}
            </td>
            <td class="px-2 py-2 font-medium text-gray-900">
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
