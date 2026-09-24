<script setup lang="ts">
import { VISIBILITIES } from '~~/shared/sharing'
import type { ShareState, ShareResourceType, Visibility } from '~~/shared/sharing'

const props = defineProps<{
  open: boolean
  resourceType: ShareResourceType
  resourceId: string
  resourceName: string
  /** App-relative path the share link points at, e.g. `/players/fabian/decks/deck-1`. */
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

const { t } = useI18n()
const count = useCount()
const apiError = useApiError()

const title = computed(() => t(`sharing.shareModal.title.${props.resourceType}`))

// The "public makes grants moot" hint on the grants section: one full
// sentence per resource type, since German needs the matching article
// ("dieses Deck" / "diese Sammlung" / "dieses Inventar").
const publicHint = computed(() => t(`sharing.shareModal.publicHint.${props.resourceType}`))

// "Privat – Nur du kannst das sehen." stopped being true the moment a grant
// exists (UX review #20: a granted user really could open a "private" deck)
// — the description has to reflect that instead of a static string.
const visibilityItems = computed(() => {
  const grantCount = state.value?.grants.length ?? 0
  return VISIBILITIES.map((value) => {
    if (value === 'private' && grantCount > 0) {
      return {
        value,
        label: t(`sharing.visibility.${value}.label`),
        description: count('sharing.visibility.private.descriptionWithGrants', grantCount),
      }
    }
    return {
      value,
      label: t(`sharing.visibility.${value}.label`),
      description: t(`sharing.visibility.${value}.description`),
    }
  })
})

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
    errorMessage.value = apiError(error, 'sharing.shareModal.errors.loadFailed')
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
    errorMessage.value = apiError(error, 'sharing.shareModal.errors.saveFailed')
  }
  finally {
    isSaving.value = false
  }
}

const shareUrl = computed(() => {
  // A `sharePath` built from an own profile that has not (yet) loaded its
  // handle would produce a broken `/players//...` URL — defense in depth on
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

const { confirm } = useConfirm()

async function regenerateToken() {
  const confirmed = await confirm({
    title: t('sharing.shareModal.confirm.regenerate.title'),
    description: t('sharing.shareModal.confirm.regenerate.description'),
  })
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
    errorMessage.value = apiError(error, 'sharing.shareModal.errors.regenerateFailed')
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
    errorMessage.value = apiError(error, 'sharing.shareModal.errors.addGrantFailed')
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
    errorMessage.value = apiError(error, 'sharing.shareModal.errors.removeGrantFailed')
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
        <p class="text-sm text-muted">
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
            v-if="state.visibility === 'link'"
            class="space-y-2"
          >
            <UInput
              :model-value="shareUrl"
              readonly
              :aria-label="t('sharing.shareModal.linkLabel')"
              class="w-full"
            />
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                :label="justCopied ? t('sharing.shareModal.linkCopied') : t('sharing.shareModal.copyLink')"
                :disabled="!shareUrl"
                @click="copyLink"
              />
              <UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                :label="t('sharing.shareModal.regenerate')"
                :disabled="isSaving"
                @click="regenerateToken"
              />
            </div>
          </div>

          <div
            class="space-y-2"
            :class="{ 'pointer-events-none opacity-50': state.visibility === 'public' }"
          >
            <h3 class="text-sm font-semibold text-highlighted">
              {{ t('sharing.shareModal.grantsTitle') }}
            </h3>

            <p
              v-if="state.visibility === 'public'"
              class="text-sm text-muted"
            >
              {{ publicHint }}
            </p>

            <SharingUserPicker @select="addGrant" />

            <p
              v-if="state.grants.length === 0"
              class="text-sm text-muted"
            >
              {{ t('sharing.shareModal.noGrants') }}
            </p>
            <ul
              v-else
              class="divide-y divide-default rounded-lg border border-default bg-default"
            >
              <li
                v-for="grant in state.grants"
                :key="grant.userId"
                class="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ grant.displayName }}
                  </p>
                  <p class="truncate text-xs text-muted">
                    {{ t('sharing.handle', { handle: grant.handle }) }}
                  </p>
                </div>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  :label="t('common.remove')"
                  class="tap-target"
                  @click="removeGrant(grant.userId)"
                />
              </li>
            </ul>
          </div>

          <p
            v-if="errorMessage"
            class="text-sm text-error"
          >
            {{ errorMessage }}
          </p>
        </template>
      </div>
    </template>
  </UModal>
</template>
