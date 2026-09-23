<script setup lang="ts">
import { TOURNAMENT_ERROR_MESSAGES } from '~~/shared/tournaments'
import type { TournamentDetail, TournamentErrorCode, TournamentParticipantDto } from '~~/shared/tournaments'
import { apiErrorCode, apiErrorMessage } from '~/utils/card-entry'

const props = defineProps<{
  tournament: TournamentDetail
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
}>()

/** Explains the "Konto" badge — as its tooltip and in the legend under the table (#28). */
const KONTO_HINT = 'Spieler mit eigenem Benutzerkonto – meldet sein Deck selbst an. Gäste ohne Konto verwaltet die Turnierleitung.'

function errorText(error: unknown, fallback: string) {
  const code = apiErrorCode(error) as TournamentErrorCode | undefined
  return (code && TOURNAMENT_ERROR_MESSAGES[code]) || apiErrorMessage(error, fallback)
}

// --- Add participant --------------------------------------------------------

const addMode = ref<'email' | 'guest'>('email')
const emailInput = ref('')
const nameInput = ref('')
const isAdding = ref(false)
const addError = ref('')

const canAddParticipant = computed(() =>
  props.tournament.role === 'organizer' && props.tournament.status === 'registration')

async function addParticipant() {
  if (isAdding.value) {
    return
  }

  isAdding.value = true
  addError.value = ''

  try {
    const body = addMode.value === 'email' ? { email: emailInput.value } : { name: nameInput.value }
    const detail = await $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/participants`, {
      method: 'POST',
      body,
    })
    emailInput.value = ''
    nameInput.value = ''
    emit('updated', detail)
  }
  catch (error) {
    addError.value = errorText(error, 'Der Teilnehmer konnte nicht hinzugefügt werden.')
  }
  finally {
    isAdding.value = false
  }
}

/**
 * "Zu dieser E-Mail-Adresse gibt es kein Konto." offers no way out — switch
 * to the guest form and keep whatever name-ish text the organizer already
 * typed (the e-mail's local part, if there was no name yet) so they don't
 * have to retype it (#37).
 */
const showAddAsGuestHint = computed(() => addError.value === TOURNAMENT_ERROR_MESSAGES.user_not_found)

function addAsGuestInstead() {
  if (!nameInput.value && emailInput.value) {
    nameInput.value = emailInput.value.split('@')[0] ?? ''
  }
  addMode.value = 'guest'
  addError.value = ''
}

// --- Rename -----------------------------------------------------------------

const renamingParticipant = ref<TournamentParticipantDto | null>(null)
const renameValue = ref('')
const isRenaming = ref(false)
const renameError = ref('')
const isRenameOpen = computed({
  get: () => renamingParticipant.value !== null,
  set: (value: boolean) => {
    if (!value) {
      renamingParticipant.value = null
    }
  },
})

function openRename(participant: TournamentParticipantDto) {
  renamingParticipant.value = participant
  renameValue.value = participant.name
  renameError.value = ''
}

async function saveRename() {
  if (!renamingParticipant.value || isRenaming.value) {
    return
  }

  isRenaming.value = true
  renameError.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(
      `/api/tournaments/${props.tournament.id}/participants/${renamingParticipant.value.id}`,
      { method: 'PATCH', body: { name: renameValue.value } },
    )
    emit('updated', detail)
    renamingParticipant.value = null
  }
  catch (error) {
    renameError.value = errorText(error, 'Der Teilnehmer konnte nicht umbenannt werden.')
  }
  finally {
    isRenaming.value = false
  }
}

// --- Drop / remove -----------------------------------------------------------

const busyParticipantId = ref<string | null>(null)
const rowError = ref('')

async function setDropped(participant: TournamentParticipantDto, dropped: boolean) {
  busyParticipantId.value = participant.id
  rowError.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(
      `/api/tournaments/${props.tournament.id}/participants/${participant.id}`,
      { method: 'PATCH', body: { dropped } },
    )
    emit('updated', detail)
  }
  catch (error) {
    rowError.value = errorText(error, 'Der Status konnte nicht geändert werden.')
  }
  finally {
    busyParticipantId.value = null
  }
}

const { confirm } = useConfirm()

async function removeParticipant(participant: TournamentParticipantDto) {
  // Destructive and irreversible — a registered deck is lost with the row —
  // so it gets the same confirm as every other destructive action in the
  // app (#28), now via the themed useConfirm() dialog instead of a native
  // `window.confirm` (#14).
  const confirmed = await confirm({
    title: 'Teilnehmer entfernen',
    description: `${participant.name} aus dem Turnier entfernen? Ein angemeldetes Deck geht dabei verloren.`,
  })
  if (!confirmed) {
    return
  }

  busyParticipantId.value = participant.id
  rowError.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(
      `/api/tournaments/${props.tournament.id}/participants/${participant.id}`,
      { method: 'DELETE' },
    )
    emit('updated', detail)
  }
  catch (error) {
    rowError.value = errorText(error, 'Der Teilnehmer konnte nicht entfernt werden.')
  }
  finally {
    busyParticipantId.value = null
  }
}

function menuItemsFor(participant: TournamentParticipantDto) {
  const items = []

  if (props.tournament.role === 'organizer' && props.tournament.status !== 'finished') {
    items.push({
      label: 'Umbenennen',
      icon: 'i-lucide-pencil',
      onSelect: () => openRename(participant),
    })
  }

  if (props.tournament.role === 'organizer' && props.tournament.status === 'running') {
    items.push({
      label: participant.dropped ? 'Zurückholen' : 'Aussteigen lassen',
      icon: participant.dropped ? 'i-lucide-undo-2' : 'i-lucide-user-x',
      onSelect: () => setDropped(participant, !participant.dropped),
    })
  }

  if (props.tournament.role === 'organizer' && props.tournament.status === 'registration') {
    items.push({
      label: 'Entfernen',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => removeParticipant(participant),
    })
  }

  return items.length > 0 ? [items] : []
}

// --- Deck registration --------------------------------------------------------

const deckModalOpen = ref(false)
const deckModalParticipant = ref<TournamentParticipantDto | null>(null)

function canRegisterDeck(participant: TournamentParticipantDto): boolean {
  if (props.tournament.status !== 'registration') {
    return false
  }
  return participant.isSelf || (props.tournament.role === 'organizer' && !participant.linked)
}

function openDeckModal(participant: TournamentParticipantDto) {
  deckModalParticipant.value = participant
  deckModalOpen.value = true
}

function onDeckUpdated(detail: TournamentDetail) {
  emit('updated', detail)
}

// A linked participant who isn't the caller and isn't self-registerable by
// the organizer either (i.e. any other linked participant while the
// tournament is still open) manages their own deck — say so instead of just
// omitting the button silently (#34).
function managesOwnDeck(participant: TournamentParticipantDto): boolean {
  return props.tournament.status === 'registration'
    && participant.linked
    && !participant.isSelf
    && !canRegisterDeck(participant)
}

// Whether a row has anything to act on. On phones the actions cell is a
// full-width strip under the card, so a row with nothing in it hides that
// cell instead of leaving an empty bordered strip (#28).
function rowHasActions(participant: TournamentParticipantDto): boolean {
  return canRegisterDeck(participant)
    || managesOwnDeck(participant)
    || menuItemsFor(participant).length > 0
}

// No row has anything to act on (e.g. a finished tournament, or a
// participant viewing a running one) — drop the empty "Aktionen" column.
const hasRowActions = computed(() => props.tournament.participants.some(rowHasActions))

// The caller's own row, when they play in the tournament — used for the
// "register before it starts" banner below (#31).
const selfParticipant = computed(() =>
  props.tournament.participants.find(participant => participant.id === props.tournament.selfParticipantId) ?? null)

const showDeckReminder = computed(() =>
  props.tournament.role === 'participant'
  && props.tournament.status === 'registration'
  && selfParticipant.value !== null
  && !selfParticipant.value.deckName)

function openOwnDeckModal() {
  if (selfParticipant.value) {
    openDeckModal(selfParticipant.value)
  }
}

function deckBadge(participant: TournamentParticipantDto): { label: string, color: 'success' | 'error' | 'neutral' } | null {
  // deckName is snapshot-derived and survives the underlying deck being
  // deleted (deckId is ON DELETE SET NULL); gate on it, not on deckId, so a
  // deleted deck keeps showing the registered snapshot's legality badge.
  if (!participant.deckName) {
    return null
  }
  if (participant.deckLegal === null) {
    return { label: 'Ohne Format', color: 'neutral' }
  }
  return participant.deckLegal
    ? { label: 'Legal', color: 'success' }
    : { label: 'Nicht legal', color: 'error' }
}

function issueCountLabel(participant: TournamentParticipantDto): string | null {
  if (!participant.deckIssueCount) {
    return null
  }
  return participant.deckIssueCount === 1 ? '1 Regelverstoß' : `${participant.deckIssueCount} Regelverstöße`
}

function issueMessages(participant: TournamentParticipantDto): string[] {
  return participant.deckSnapshot?.validation?.issues ?? []
}

// "Stand: 12.9.2026, 13:13:52" was overly precise and ambiguous about what
// it meant; "Angemeldet am 12.09.2026, 13:13" (no seconds) reads clearly (#30).
function capturedAtLabel(participant: TournamentParticipantDto): string | null {
  const capturedAt = participant.deckSnapshot?.capturedAt
  if (!capturedAt) {
    return null
  }
  const formatted = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(capturedAt))
  return `Angemeldet am ${formatted}`
}
</script>

<template>
  <section class="rounded-md border border-gray-200 bg-white p-4">
    <h2 class="text-base font-semibold text-gray-900">
      Teilnehmer ({{ tournament.participants.length }})
    </h2>

    <UAlert
      v-if="showDeckReminder"
      class="mt-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-alert-triangle"
      title="Melde dein Deck an, bevor das Turnier startet."
    >
      <template #actions>
        <UButton
          size="xs"
          label="Deck anmelden"
          class="tap-target"
          @click="openOwnDeckModal"
        />
      </template>
    </UAlert>

    <form
      v-if="canAddParticipant"
      class="mt-4 flex flex-wrap items-end gap-2"
      @submit.prevent="addParticipant"
    >
      <div class="flex gap-2">
        <UButton
          type="button"
          size="sm"
          color="neutral"
          :variant="addMode === 'email' ? 'solid' : 'outline'"
          :aria-pressed="addMode === 'email'"
          label="Per E-Mail"
          @click="() => { addMode = 'email' }"
        />
        <UButton
          type="button"
          size="sm"
          color="neutral"
          :variant="addMode === 'guest' ? 'solid' : 'outline'"
          :aria-pressed="addMode === 'guest'"
          label="Als Gast"
          @click="() => { addMode = 'guest' }"
        />
      </div>

      <UInput
        v-if="addMode === 'email'"
        v-model="emailInput"
        type="email"
        placeholder="spieler@example.com"
        aria-label="E-Mail-Adresse"
      />
      <UInput
        v-else
        v-model="nameInput"
        placeholder="Name des Gasts"
        maxlength="60"
        aria-label="Name"
      />

      <UButton
        type="submit"
        icon="i-lucide-user-plus"
        label="Teilnehmer hinzufügen"
        :loading="isAdding"
      />
    </form>
    <div
      v-if="addError"
      class="mt-2 flex flex-wrap items-center gap-2"
    >
      <p class="text-sm text-red-600">
        {{ addError }}
      </p>
      <UButton
        v-if="showAddAsGuestHint"
        size="xs"
        color="neutral"
        variant="outline"
        label="Stattdessen als Gast hinzufügen"
        @click="addAsGuestInstead"
      />
    </div>

    <p
      v-if="rowError"
      class="mt-2 text-sm text-red-600"
    >
      {{ rowError }}
    </p>

    <!-- One <table> for both layouts (#28): below `sm` the rows are restyled
         as stacked cards via CSS instead of rendering a second, duplicated
         card list. Changing `display` on table elements can drop their
         implicit semantics (notably in Safari), so the ARIA roles are
         spelled out explicitly. -->
    <div class="mt-4 overflow-x-auto">
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
              #
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              Name
            </th>
            <th
              role="columnheader"
              class="px-2 py-2"
            >
              Deck
            </th>
            <th
              v-if="hasRowActions"
              role="columnheader"
              class="px-2 py-2 text-right"
            >
              Aktionen
            </th>
          </tr>
        </thead>
        <tbody
          role="rowgroup"
          class="block space-y-2 sm:table-row-group sm:space-y-0 sm:divide-y sm:divide-gray-100"
        >
          <tr
            v-for="participant in tournament.participants"
            :key="participant.id"
            role="row"
            class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border border-gray-200 p-3 sm:table-row sm:rounded-none sm:border-0 sm:p-0"
          >
            <td
              role="cell"
              class="tabular-nums text-gray-500 sm:py-2 sm:pr-2"
            >
              <span class="sm:hidden">#</span>{{ participant.seed }}
            </td>
            <td
              role="cell"
              class="font-medium text-gray-900 sm:px-2 sm:py-2"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <span>{{ participant.name }}</span>
                <UBadge
                  v-if="participant.linked"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-user-check"
                  label="Konto"
                  :title="KONTO_HINT"
                />
                <UBadge
                  v-if="participant.dropped"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  label="Ausgestiegen"
                />
              </div>
            </td>
            <td
              role="cell"
              class="col-start-2 sm:px-2 sm:py-2"
            >
              <template v-if="participant.deckName">
                <div class="text-gray-900">
                  {{ participant.deckName }}
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-1">
                  <UPopover v-if="deckBadge(participant) && participant.deckIssueCount">
                    <button
                      type="button"
                      class="tap-target inline-flex items-center gap-1 rounded hover:bg-gray-50"
                      :aria-label="`Regelverstöße von ${participant.name} anzeigen`"
                    >
                      <UBadge
                        size="sm"
                        variant="subtle"
                        :color="deckBadge(participant)!.color"
                        :label="deckBadge(participant)!.label"
                      />
                      <span class="text-xs text-gray-500">{{ issueCountLabel(participant) }}</span>
                    </button>

                    <template #content>
                      <div class="max-w-xs space-y-1 p-3">
                        <p class="text-xs font-semibold text-gray-900">
                          Regelverstöße
                        </p>
                        <ul class="list-inside list-disc space-y-0.5 text-xs text-gray-600">
                          <li
                            v-for="(issue, index) in issueMessages(participant)"
                            :key="index"
                          >
                            {{ issue }}
                          </li>
                        </ul>
                      </div>
                    </template>
                  </UPopover>
                  <UBadge
                    v-else-if="deckBadge(participant)"
                    size="sm"
                    variant="subtle"
                    :color="deckBadge(participant)!.color"
                    :label="deckBadge(participant)!.label"
                  />
                </div>
                <div
                  v-if="capturedAtLabel(participant)"
                  class="mt-0.5 text-xs text-gray-400"
                >
                  {{ capturedAtLabel(participant) }}
                </div>
              </template>
              <span
                v-else
                class="text-gray-400"
              >Kein Deck</span>
            </td>
            <td
              v-if="hasRowActions"
              role="cell"
              class="col-span-full border-t border-gray-100 pt-2 sm:border-0 sm:px-2 sm:py-2"
              :class="rowHasActions(participant) ? undefined : 'max-sm:hidden'"
            >
              <div class="flex items-center justify-start gap-2 sm:justify-end">
                <UButton
                  v-if="canRegisterDeck(participant)"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  class="tap-target"
                  :label="participant.deckName ? 'Deck ändern' : 'Deck anmelden'"
                  @click="openDeckModal(participant)"
                />
                <span
                  v-else-if="managesOwnDeck(participant)"
                  class="text-xs text-gray-400"
                >Meldet Deck selbst an</span>
                <UDropdownMenu
                  v-if="menuItemsFor(participant).length > 0"
                  :items="menuItemsFor(participant)"
                >
                  <UButton
                    icon="i-lucide-more-horizontal"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Optionen für ${participant.name}`"
                    :loading="busyParticipantId === participant.id"
                    class="tap-target"
                  />
                </UDropdownMenu>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-if="tournament.participants.some(participant => participant.linked)"
      class="mt-3 flex items-start gap-1.5 text-xs text-gray-500"
    >
      <UIcon
        name="i-lucide-user-check"
        class="mt-px size-3.5 shrink-0"
      />
      <span>„Konto“: {{ KONTO_HINT }}</span>
    </p>

    <UModal
      v-model:open="isRenameOpen"
      title="Teilnehmer umbenennen"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name">
            <UInput
              v-model="renameValue"
              maxlength="60"
              aria-label="Name des Teilnehmers"
            />
          </UFormField>
          <p
            v-if="renameError"
            class="text-sm text-red-600"
          >
            {{ renameError }}
          </p>
          <div class="flex justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              label="Abbrechen"
              @click="() => { renamingParticipant = null }"
            />
            <UButton
              label="Speichern"
              :loading="isRenaming"
              @click="saveRename"
            />
          </div>
        </div>
      </template>
    </UModal>

    <TournamentsDeckRegistrationModal
      v-model:open="deckModalOpen"
      :tournament-id="tournament.id"
      :participant-id="deckModalParticipant?.id ?? null"
      :current-deck-id="deckModalParticipant?.deckId ?? null"
      :format="tournament.format"
      @updated="onDeckUpdated"
    />
  </section>
</template>
