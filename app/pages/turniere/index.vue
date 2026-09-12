<script setup lang="ts">
import {
  PAIRING_SYSTEM_LABELS,
  TOURNAMENT_STATUS_LABELS,
} from '~~/shared/tournaments'
import type { TournamentListItem, TournamentListResponse, TournamentStatus } from '~~/shared/tournaments'

const PAGE_SIZE = 20

useHead({ title: 'Turniere – yugioh alpha' })

type RoleTab = 'organizer' | 'participant'
type StatusFilter = 'active' | 'finished'

// Two independent axes instead of three tabs that used to mix role and
// status (#32 in the UX review): a role tab picks "Meine Turniere" vs.
// "Teilnahmen", a separate toggle picks "Aktiv" vs. "Abgeschlossen". Neither
// hardcodes `status: active` behind the role tabs anymore, so an organizer's
// own finished tournament stays reachable under "Meine Turniere" +
// "Abgeschlossen" instead of vanishing.
const role = ref<RoleTab>('organizer')
const statusFilter = ref<StatusFilter>('active')
const page = ref(1)

watch([role, statusFilter], () => {
  page.value = 1
})

const listQuery = computed(() => ({
  role: role.value,
  status: statusFilter.value,
  page: page.value,
  pageSize: PAGE_SIZE,
}))

const { data, pending } = await useFetch<TournamentListResponse>('/api/tournaments', {
  query: listQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE }),
  watch: [listQuery],
})

// Cheap, count-only fetch for the tab the user isn't currently looking at,
// purely to label it ("Teilnahmen (1)") and to detect the "my tournaments is
// empty but I do have participations" case for the hint below.
const otherRole = computed<RoleTab>(() => (role.value === 'organizer' ? 'participant' : 'organizer'))
const otherRoleQuery = computed(() => ({
  role: otherRole.value,
  status: statusFilter.value,
  page: 1,
  pageSize: 1,
}))

const { data: otherRoleData } = await useFetch<TournamentListResponse>('/api/tournaments', {
  query: otherRoleQuery,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [], total: 0, page: 1, pageSize: 1 }),
  watch: [otherRoleQuery],
})

const tournaments = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const otherRoleTotal = computed(() => otherRoleData.value?.total ?? 0)

function countFor(tabRole: RoleTab): number {
  return tabRole === role.value ? total.value : otherRoleTotal.value
}

function tabLabel(tabRole: RoleTab): string {
  const base = tabRole === 'organizer' ? 'Meine Turniere' : 'Teilnahmen'
  return `${base} (${countFor(tabRole)})`
}

function selectRole(next: RoleTab) {
  role.value = next
}

function selectStatus(next: StatusFilter) {
  statusFilter.value = next
}

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

// The organizer tab is empty, but the user does have participations — the
// most common reason someone lands here confused (#31): they were invited
// and never noticed. Offer a direct switch instead of a dead end.
const showParticipantHint = computed(() =>
  role.value === 'organizer' && tournaments.value.length === 0 && otherRoleTotal.value > 0)

const emptyState = computed(() => {
  if (role.value === 'organizer') {
    if (statusFilter.value === 'active') {
      return {
        heading: 'Noch keine Turniere',
        text: 'Lege dein erstes Turnier an und lade Spieler per E-Mail oder als Gast ein.',
        showButton: true,
      }
    }
    return {
      heading: 'Noch keine abgeschlossenen Turniere',
      text: 'Turniere, die du leitest, erscheinen hier, sobald du sie abschließt.',
      showButton: false,
    }
  }
  if (statusFilter.value === 'active') {
    return {
      heading: 'Keine Teilnahmen',
      text: 'Du bist noch zu keinem Turnier eingeladen.',
      showButton: false,
    }
  }
  return {
    heading: 'Keine abgeschlossenen Teilnahmen',
    text: 'Turniere, an denen du teilgenommen hast, erscheinen hier, sobald sie abgeschlossen sind.',
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

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          :variant="role === 'organizer' ? 'solid' : 'outline'"
          :aria-pressed="role === 'organizer'"
          :label="tabLabel('organizer')"
          @click="selectRole('organizer')"
        />
        <UButton
          color="neutral"
          :variant="role === 'participant' ? 'solid' : 'outline'"
          :aria-pressed="role === 'participant'"
          :label="tabLabel('participant')"
          @click="selectRole('participant')"
        />
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          size="sm"
          color="neutral"
          :variant="statusFilter === 'active' ? 'solid' : 'outline'"
          :aria-pressed="statusFilter === 'active'"
          label="Aktiv"
          @click="selectStatus('active')"
        />
        <UButton
          size="sm"
          color="neutral"
          :variant="statusFilter === 'finished' ? 'solid' : 'outline'"
          :aria-pressed="statusFilter === 'finished'"
          label="Abgeschlossen"
          @click="selectStatus('finished')"
        />
      </div>
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
      <p
        v-if="showParticipantHint"
        class="mt-1 max-w-sm text-sm text-gray-500"
      >
        Du nimmst an {{ otherRoleTotal }} Turnier{{ otherRoleTotal === 1 ? '' : 'en' }} teil.
      </p>
      <UButton
        v-if="showParticipantHint"
        color="primary"
        variant="outline"
        label="Eingeladene Turniere ansehen"
        class="mt-4"
        @click="selectRole('participant')"
      />
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
          <div v-if="role === 'participant'">
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
