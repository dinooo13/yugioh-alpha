<script setup lang="ts">
import {
  PAIRING_SYSTEM_LABELS,
  TOURNAMENT_STATUS_LABELS,
} from '~~/shared/tournaments'
import type { TournamentListItem, TournamentListResponse, TournamentStatus } from '~~/shared/tournaments'

const PAGE_SIZE = 20

useHead({ title: 'Turniere – yugioh alpha' })

type TabId = 'organizer' | 'participant' | 'finished'

const tab = ref<TabId>('organizer')
const page = ref(1)

watch(tab, () => {
  page.value = 1
})

const listQuery = computed(() => (tab.value === 'finished'
  ? { status: 'finished' as const, page: page.value, pageSize: PAGE_SIZE }
  : { role: tab.value, status: 'active' as const, page: page.value, pageSize: PAGE_SIZE }))

const { data, pending } = await useFetch<TournamentListResponse>('/api/tournaments', {
  query: listQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
  watch: [listQuery],
})

const tournaments = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

const STATUS_COLORS: Record<TournamentStatus, 'info' | 'warning' | 'neutral'> = {
  registration: 'info',
  running: 'warning',
  finished: 'neutral',
}

function statusColor(status: TournamentStatus) {
  return STATUS_COLORS[status]
}

function roundLabel(item: TournamentListItem) {
  return `Runde ${item.roundCount}/${item.plannedRounds ?? '–'}`
}

const emptyState = computed(() => {
  if (tab.value === 'organizer') {
    return {
      heading: 'Noch keine Turniere',
      text: 'Lege dein erstes Turnier an und lade Spieler per E-Mail oder als Gast ein.',
      showButton: true,
    }
  }
  if (tab.value === 'participant') {
    return {
      heading: 'Keine Teilnahmen',
      text: 'Du bist noch zu keinem Turnier eingeladen.',
      showButton: false,
    }
  }
  return {
    heading: 'Noch keine abgeschlossenen Turniere',
    text: '',
    showButton: false,
  }
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">
          Turniere
        </h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ total }} Turnier{{ total === 1 ? '' : 'e' }}
        </p>
      </div>

      <UButton
        icon="i-lucide-plus"
        label="Neues Turnier"
        to="/turniere/neu"
      />
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton
        color="neutral"
        :variant="tab === 'organizer' ? 'solid' : 'outline'"
        :aria-pressed="tab === 'organizer'"
        label="Meine Turniere"
        @click="() => { tab = 'organizer' }"
      />
      <UButton
        color="neutral"
        :variant="tab === 'participant' ? 'solid' : 'outline'"
        :aria-pressed="tab === 'participant'"
        label="Teilnahmen"
        @click="() => { tab = 'participant' }"
      />
      <UButton
        color="neutral"
        :variant="tab === 'finished' ? 'solid' : 'outline'"
        :aria-pressed="tab === 'finished'"
        label="Abgeschlossen"
        @click="() => { tab = 'finished' }"
      />
    </div>

    <div
      v-if="pending"
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-36 w-full"
      />
    </div>

    <div
      v-else-if="tournaments.length === 0"
      class="flex flex-col items-center rounded-md border border-gray-200 bg-white px-6 py-12 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <UIcon
          name="i-lucide-trophy"
          class="size-6"
        />
      </div>
      <h2 class="mt-4 text-base font-semibold text-gray-900">
        {{ emptyState.heading }}
      </h2>
      <p
        v-if="emptyState.text"
        class="mt-1 max-w-sm text-sm text-gray-500"
      >
        {{ emptyState.text }}
      </p>
      <UButton
        v-if="emptyState.showButton"
        icon="i-lucide-plus"
        label="Neues Turnier"
        class="mt-4"
        to="/turniere/neu"
      />
    </div>

    <ul
      v-else
      class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <li
        v-for="item in tournaments"
        :key="item.id"
        class="flex flex-col rounded-md border border-gray-200 bg-white p-4"
      >
        <NuxtLink :to="`/turniere/${item.id}`">
          <h2 class="truncate text-base font-semibold text-gray-900 hover:text-primary">
            {{ item.name }}
          </h2>
        </NuxtLink>
        <p
          v-if="item.description"
          class="mt-0.5 line-clamp-2 text-sm text-gray-500"
        >
          {{ item.description }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusColor(item.status)"
            variant="subtle"
            :label="TOURNAMENT_STATUS_LABELS[item.status]"
          />
          <UBadge
            v-if="item.format"
            color="neutral"
            variant="subtle"
            icon="i-lucide-scroll-text"
            :label="item.format.name"
          />
        </div>

        <dl class="mt-3 space-y-0.5 text-sm text-gray-500">
          <div>{{ item.participantCount }} Teilnehmer</div>
          <div>{{ roundLabel(item) }}</div>
          <div>{{ PAIRING_SYSTEM_LABELS[item.pairingSystem] }}</div>
          <div v-if="tab === 'participant'">
            Von {{ item.organizerName }}
          </div>
        </dl>
      </li>
    </ul>

    <div
      v-if="total > PAGE_SIZE"
      class="flex justify-end"
    >
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="PAGE_SIZE"
      />
    </div>
  </div>
</template>
