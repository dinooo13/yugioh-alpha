<script setup lang="ts">
import { VISIBILITIES, VISIBILITY_DESCRIPTIONS, VISIBILITY_LABELS } from '~~/shared/sharing'
import type { ShareResourceType, ShareState, Visibility } from '~~/shared/sharing'
import { apiErrorMessage } from '~/utils/card-entry'

const props = defineProps<{
  open: boolean
  resourceType: ShareResourceType
  resourceId: string
  resourceName: string
  /** App-relative path the share link points at, e.g. `/spieler/fabian/decks/deck-1`. */
  sharePath: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': [visibility: Visibility]
}>()

const openProxy = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const TITLES: Record<ShareResourceType, string> = {
  deck: 'Deck teilen',
  collection: 'Sammlung teilen',
  inventory: 'Inventar teilen',
}
const title = computed(() => TITLES[props.resourceType])

const visibilityItems = VISIBILITIES.map(value => ({
  value,
  label: VISIBILITY_LABELS[value],
  description: VISIBILITY_DESCRIPTIONS[value],
}))

const state = ref<ShareState | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const justCopied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    state.value = await $fetch<ShareState>(`/api/sharing/${props.resourceType}/${props.resourceId}`)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Freigabe konnte nicht geladen werden.')
  }
  finally {
    isLoading.value = false
  }
}

watch(() => [props.open, props.resourceType, props.resourceId] as const, ([open]) => {
  if (open) {
    load()
  }
}, { immediate: true })

const visibilityProxy = computed<Visibility>({
  get: () => state.value?.visibility ?? 'private',
  set: (value) => {
    setVisibility(value)
  },
})

async function setVisibility(visibility: Visibility) {
  if (isSaving.value || state.value?.visibility === visibility) {
    return
  }

  isSaving.value = true
  errorMessage.value = ''
  try {
    state.value = await $fetch<ShareState>(`/api/sharing/${props.resourceType}/${props.resourceId}`, {
      method: 'PUT',
      body: { visibility },
    })
    emit('updated', state.value.visibility)
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Freigabe konnte nicht gespeichert werden.')
  }
  finally {
    isSaving.value = false
  }
}

const shareUrl = computed(() => {
  // A `sharePath` built from an own profile that has not (yet) loaded its
  // handle would produce a broken `/spieler//...` URL — defense in depth on
  // top of the caller disabling "Teilen" until the handle is known.
  if (!state.value?.shareToken || props.sharePath.includes('//')) {
    return ''
  }
  const origin = import.meta.client ? window.location.origin : ''
  return `${origin}${props.sharePath}?token=${state.value.shareToken}`
})

async function copyLink() {
  if (!shareUrl.value) {
    return
  }

  await navigator.clipboard.writeText(shareUrl.value)
  justCopied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    justCopied.value = false
  }, 2000)
}

async function regenerateToken() {
  const confirmed = window.confirm('Alte Links werden dadurch ungültig. Fortfahren?')
  if (!confirmed) {
    return
  }

  isSaving.value = true
  errorMessage.value = ''
  try {
    state.value = await $fetch<ShareState>(`/api/sharing/${props.resourceType}/${props.resourceId}`, {
      method: 'PUT',
      body: { regenerateToken: true },
    })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Der Link konnte nicht erneuert werden.')
  }
  finally {
    isSaving.value = false
  }
}

async function addGrant(userId: string) {
  errorMessage.value = ''
  try {
    state.value = await $fetch<ShareState>(`/api/sharing/${props.resourceType}/${props.resourceId}/grants`, {
      method: 'POST',
      body: { userId },
    })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Der Spieler konnte nicht hinzugefügt werden.')
  }
}

async function removeGrant(userId: string) {
  errorMessage.value = ''
  try {
    state.value = await $fetch<ShareState>(`/api/sharing/${props.resourceType}/${props.resourceId}/grants/${userId}`, {
      method: 'DELETE',
    })
  }
  catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Die Freigabe konnte nicht entfernt werden.')
  }
}
</script>

<template>
  <UModal
    v-model:open="openProxy"
    :title="title"
  >
    <template #body>
      <div class="space-y-5">
        <p class="text-sm text-gray-500">
          {{ resourceName }}
        </p>

        <div
          v-if="isLoading && !state"
          class="space-y-2"
        >
          <USkeleton class="h-24 w-full" />
        </div>

        <template v-else-if="state">
          <URadioGroup
            v-model="visibilityProxy"
            :items="visibilityItems"
            :disabled="isSaving"
          />

          <div
            v-if="state.visibility !== 'private'"
            class="space-y-2"
          >
            <UInput
              :model-value="shareUrl"
              readonly
              aria-label="Freigabe-Link"
              class="w-full"
            />
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                :label="justCopied ? 'Link kopiert' : 'Link kopieren'"
                :disabled="!shareUrl"
                @click="copyLink"
              />
              <UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                label="Neuen Link erzeugen"
                :disabled="isSaving"
                @click="regenerateToken"
              />
            </div>
          </div>

          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-gray-900">
              Für einzelne Spieler freigegeben
            </h3>

            <SharingUserPicker @select="addGrant" />

            <p
              v-if="state.grants.length === 0"
              class="text-sm text-gray-500"
            >
              Noch keine Spieler freigegeben.
            </p>
            <ul
              v-else
              class="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white"
            >
              <li
                v-for="grant in state.grants"
                :key="grant.userId"
                class="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-gray-900">
                    {{ grant.displayName }}
                  </p>
                  <p class="truncate text-xs text-gray-500">
                    @{{ grant.handle }}
                  </p>
                </div>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  label="Entfernen"
                  @click="removeGrant(grant.userId)"
                />
              </li>
            </ul>
          </div>

          <p
            v-if="errorMessage"
            class="text-sm text-red-600"
          >
            {{ errorMessage }}
          </p>
        </template>
      </div>
    </template>
  </UModal>
</template>
