<script setup lang="ts">
import { formatRate, POINTS_DRAW, POINTS_WIN } from '~~/shared/tournaments'
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

    <!-- Same single-<table> card pattern as the participants panel (#28):
         below `sm` each row is a card with rank, name and points up top and
         the tie-breakers as a small definition list underneath. -->
    <div
      v-else
      class="mt-4 overflow-x-auto"
    >
      <table
        role="table"
        class="block w-full text-left text-sm sm:table"
      >
        <thead
          role="rowgroup"
          class="hidden sm:table-header-group"
        >
          <tr
            role="row"
            class="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500"
          >
            <th
              role="columnheader"
              class="py-2 pr-2"
            >
              Platz
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              Spieler
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              Punkte
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                title="Siege–Niederlagen–Unentschieden"
                class="cursor-help"
              >S-N-U</abbr>
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                title="Siegquote der Gegner"
                class="cursor-help"
              >OMW%</abbr>
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                title="Eigene Spielquote"
                class="cursor-help"
              >GW%</abbr>
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                title="Spielquote der Gegner"
                class="cursor-help"
              >OGW%</abbr>
            </th>
          </tr>
        </thead>
        <tbody
          role="rowgroup"
          class="block space-y-2 sm:table-row-group sm:space-y-0 sm:divide-y sm:divide-gray-100"
        >
          <tr
            v-for="row in standings"
            :key="row.participantId"
            role="row"
            class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-md border p-3 sm:table-row sm:rounded-none sm:border-0 sm:p-0"
            :class="row.rank === 1 ? 'border-amber-200 bg-amber-50' : 'border-gray-200'"
          >
            <td
              role="cell"
              class="tabular-nums text-gray-500 sm:py-2 sm:pr-2"
            >
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
              role="cell"
              class="font-medium sm:px-2 sm:py-2"
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
            <td
              role="cell"
              class="text-right font-semibold tabular-nums sm:px-2 sm:py-2 sm:text-left sm:font-normal"
            >
              {{ row.points }}<span class="text-xs font-normal text-gray-500 sm:hidden"> Pkt.</span>
            </td>
            <td
              role="cell"
              class="hidden tabular-nums sm:table-cell sm:px-2 sm:py-2"
            >
              {{ recordLabel(row) }}
            </td>
            <td
              role="cell"
              class="hidden tabular-nums sm:table-cell sm:px-2 sm:py-2"
            >
              {{ formatRate(row.opponentMatchWinRate) }}
            </td>
            <td
              role="cell"
              class="hidden tabular-nums sm:table-cell sm:px-2 sm:py-2"
            >
              {{ formatRate(row.gameWinRate) }}
            </td>
            <td
              role="cell"
              class="hidden tabular-nums sm:table-cell sm:px-2 sm:py-2"
            >
              {{ formatRate(row.opponentGameWinRate) }}
            </td>
            <!-- Phone-only: the tie-breaker columns above are hidden below
                 `sm`, so the card repeats them as labelled pairs. -->
            <td
              role="cell"
              class="col-span-full sm:hidden"
            >
              <dl class="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <dt class="text-gray-500">
                    S-N-U
                  </dt>
                  <dd class="tabular-nums text-gray-900">
                    {{ recordLabel(row) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">
                    OMW%
                  </dt>
                  <dd class="tabular-nums text-gray-900">
                    {{ formatRate(row.opponentMatchWinRate) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">
                    GW%
                  </dt>
                  <dd class="tabular-nums text-gray-900">
                    {{ formatRate(row.gameWinRate) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-gray-500">
                    OGW%
                  </dt>
                  <dd class="tabular-nums text-gray-900">
                    {{ formatRate(row.opponentGameWinRate) }}
                  </dd>
                </div>
              </dl>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- A visible legend rather than tooltips only: `title` never shows on
         touch devices (#28). -->
    <p class="mt-3 text-xs text-gray-500">
      Punkte: Sieg {{ POINTS_WIN }}, Unentschieden {{ POINTS_DRAW }}
      · S-N-U = Siege–Niederlagen–Unentschieden
      · OMW% = Siegquote der Gegner
      · GW% = eigene Spielquote
      · OGW% = Spielquote der Gegner
    </p>
  </section>
</template>
