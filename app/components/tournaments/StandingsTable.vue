<script setup lang="ts">
import { POINTS_DRAW, POINTS_WIN } from '~~/shared/tournaments'
import type { TournamentStandingRow, TournamentStatus } from '~~/shared/tournaments'

const props = defineProps<{
  standings: TournamentStandingRow[]
  status: TournamentStatus
}>()

const { t, n } = useI18n()

/** 0.6667 → "66,7 %" (de) / "66.7%" (en) for the standings tie-breakers. */
function formatRate(rate: number): string {
  return t('tournaments.standings.rate', { value: n(rate * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
}

const legend = computed(() => t('tournaments.standings.legend', { win: POINTS_WIN, draw: POINTS_DRAW }))

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
  <section class="rounded-md border border-default bg-default p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.standings.title') }}
      </h2>
      <p
        v-if="winner"
        class="flex items-center gap-1.5 text-sm font-semibold text-warning"
      >
        <UIcon
          name="i-lucide-trophy"
          class="size-4"
        />
        {{ t('tournaments.standings.winner', { name: winner.name }) }}
      </p>
    </div>

    <p
      v-if="standings.length === 0"
      class="mt-4 text-sm text-muted"
    >
      {{ t('tournaments.standings.empty') }}
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
            class="border-b border-default text-xs uppercase tracking-wide text-muted"
          >
            <th
              role="columnheader"
              class="py-2 pr-2"
            >
              {{ t('tournaments.standings.columns.rank') }}
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              {{ t('tournaments.standings.columns.player') }}
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              {{ t('tournaments.standings.columns.points') }}
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                :title="t('tournaments.standings.recordTitle')"
                class="cursor-help"
              >{{ t('tournaments.standings.record') }}</abbr>
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                :title="t('tournaments.standings.omwTitle')"
                class="cursor-help"
              >{{ t('tournaments.standings.omw') }}</abbr>
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                :title="t('tournaments.standings.gwTitle')"
                class="cursor-help"
              >{{ t('tournaments.standings.gw') }}</abbr>
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              <abbr
                :title="t('tournaments.standings.ogwTitle')"
                class="cursor-help"
              >{{ t('tournaments.standings.ogw') }}</abbr>
            </th>
          </tr>
        </thead>
        <tbody
          role="rowgroup"
          class="block space-y-2 sm:table-row-group sm:space-y-0 sm:divide-y sm:divide-default"
        >
          <tr
            v-for="row in standings"
            :key="row.participantId"
            role="row"
            class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-md border p-3 sm:table-row sm:rounded-none sm:border-0 sm:p-0"
            :class="row.rank === 1 ? 'border-warning/30 bg-warning/10' : 'border-default'"
          >
            <td
              role="cell"
              class="tabular-nums text-muted sm:py-2 sm:pr-2"
            >
              <span class="inline-flex items-center gap-1">
                <UIcon
                  v-if="row.rank === 1"
                  name="i-lucide-trophy"
                  class="size-3.5 text-warning"
                />
                {{ row.rank }}
              </span>
            </td>
            <td
              role="cell"
              class="font-medium sm:px-2 sm:py-2"
              :class="row.rank === 1 ? 'text-highlighted' : 'text-highlighted'"
            >
              {{ row.name }}
              <UBadge
                v-if="row.dropped"
                size="sm"
                class="ml-1"
                color="neutral"
                variant="subtle"
                :label="t('tournaments.dropped')"
              />
            </td>
            <td
              role="cell"
              class="text-right font-semibold tabular-nums sm:px-2 sm:py-2 sm:text-left sm:font-normal"
            >
              {{ row.points }}<span class="text-xs font-normal text-muted sm:hidden"> {{ t('tournaments.standings.pointsShort') }}</span>
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
                  <dt class="text-muted">
                    {{ t('tournaments.standings.record') }}
                  </dt>
                  <dd class="tabular-nums text-highlighted">
                    {{ recordLabel(row) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    {{ t('tournaments.standings.omw') }}
                  </dt>
                  <dd class="tabular-nums text-highlighted">
                    {{ formatRate(row.opponentMatchWinRate) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    {{ t('tournaments.standings.gw') }}
                  </dt>
                  <dd class="tabular-nums text-highlighted">
                    {{ formatRate(row.gameWinRate) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    {{ t('tournaments.standings.ogw') }}
                  </dt>
                  <dd class="tabular-nums text-highlighted">
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
    <p class="mt-3 text-xs text-muted">
      {{ legend }}
    </p>
  </section>
</template>
