<script setup lang="ts">
import type { OwnProfile, Visibility } from '~~/shared/sharing'
import { isAppLocale } from '~~/shared/locale'

const { t } = useI18n()
usePageTitle('profile.title')

const toast = useToast()

// Shared with the layout avatar (useOwnProfile's key), so saving the form
// updates the sidebar name and avatar too (#50).
const { data: profile, pending, error } = await useOwnProfile()

function onSaved(updated: OwnProfile) {
  profile.value = updated
}

const isShareOpen = ref(false)

function onShareUpdated(visibility: Visibility) {
  if (profile.value) {
    profile.value = { ...profile.value, inventoryVisibility: visibility }
  }
}

const isSavingWishlistVisibility = ref(false)
const wishlistVisibilitySaved = ref(false)
let wishlistVisibilitySavedTimer: ReturnType<typeof setTimeout> | undefined

async function setWishlistVisibility(makePublic: boolean) {
  if (isSavingWishlistVisibility.value || !profile.value) {
    return
  }

  const visibility = makePublic ? 'public' : 'private'
  if (profile.value.wishlistVisibility === visibility) {
    return
  }

  isSavingWishlistVisibility.value = true
  try {
    profile.value = await $fetch<OwnProfile>('/api/profile/wishlist-visibility', {
      method: 'PUT',
      body: { visibility },
    })
    // Same "Gespeichert" feedback as the form above (UX review #22) — before
    // this the switch gave no confirmation at all; only a reload proved it
    // had worked.
    wishlistVisibilitySaved.value = true
    clearTimeout(wishlistVisibilitySavedTimer)
    wishlistVisibilitySavedTimer = setTimeout(() => {
      wishlistVisibilitySaved.value = false
    }, 2000)
  }
  catch {
    // The switch is bound to `profile`, which stays untouched on failure,
    // so it keeps showing the saved state — just tell the user why.
    toast.add({ title: t('profile.wishlistVisibility.saveFailed'), color: 'error' })
  }
  finally {
    isSavingWishlistVisibility.value = false
  }
}

// Same "Gespeichert" feedback for the language switch; a failure shows a
// toast from LayoutLocaleSwitch and keeps the old language.
const localeSaved = ref(false)
let localeSavedTimer: ReturnType<typeof setTimeout> | undefined

function onLocaleSaved() {
  localeSaved.value = true
  clearTimeout(localeSavedTimer)
  localeSavedTimer = setTimeout(() => {
    localeSaved.value = false
  }, 2000)
}

// Card language (ADR 0015): follow the interface language (`null`), or a
// fixed one. Saves to the profile first; a failure keeps the old choice.
const CARD_LOCALE_FOLLOW = 'follow'
const { locale: uiLocale } = useUiLocale()
const { choice: cardLocaleChoice, change: changeCardLocale } = useCardLocale()
const cardLocaleItems = computed(() => [
  {
    label: t('profile.settings.cardLanguageOption.follow', {
      language: t(`profile.settings.cardLanguageOption.${uiLocale.value}`),
    }),
    value: CARD_LOCALE_FOLLOW,
  },
  { label: t('profile.settings.cardLanguageOption.de'), value: 'de' },
  { label: t('profile.settings.cardLanguageOption.en'), value: 'en' },
])
const isSavingCardLocale = ref(false)
const cardLocaleSaved = ref(false)
let cardLocaleSavedTimer: ReturnType<typeof setTimeout> | undefined

async function onCardLocaleChange(value: string) {
  const next = isAppLocale(value) ? value : null
  if (next === cardLocaleChoice.value || isSavingCardLocale.value) {
    return
  }
  isSavingCardLocale.value = true
  try {
    await changeCardLocale(next)
    cardLocaleSaved.value = true
    clearTimeout(cardLocaleSavedTimer)
    cardLocaleSavedTimer = setTimeout(() => {
      cardLocaleSaved.value = false
    }, 2000)
  }
  catch {
    toast.add({ title: t('profile.settings.cardLanguageSaveFailed'), color: 'error' })
  }
  finally {
    isSavingCardLocale.value = false
  }
}

const wishlistPublic = computed({
  get: () => profile.value?.wishlistVisibility === 'public',
  set: (value: boolean) => setWishlistVisibility(value),
})
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <LayoutPageHeader :title="t('profile.title')" />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="t('profile.loadFailed')"
      :description="error.message"
    />

    <div
      v-else-if="pending && !profile"
      class="space-y-4"
    >
      <USkeleton class="h-64 w-full" />
    </div>

    <template v-else-if="profile">
      <section class="rounded-md border border-default bg-default p-4">
        <ProfileForm
          :profile="profile"
          @saved="onSaved"
        />

        <div class="mt-4 border-t border-muted pt-4">
          <NuxtLink
            :to="`/players/${profile.handle}`"
            class="text-sm font-medium text-primary hover:underline"
          >
            {{ t('profile.viewPublicProfile') }}
          </NuxtLink>
        </div>
      </section>

      <section class="flex items-center justify-between gap-4 rounded-md border border-default bg-default p-4">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('profile.inventoryShare.title') }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ t('profile.inventoryShare.description') }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <SharingVisibilityBadge
            :visibility="profile.inventoryVisibility"
            hide-private
          />
          <UButton
            icon="i-lucide-share-2"
            :label="t('profile.inventoryShare.share')"
            color="neutral"
            variant="outline"
            @click="() => { isShareOpen = true }"
          />
        </div>
      </section>

      <section
        id="wishlist"
        class="flex items-center justify-between gap-4 rounded-md border border-default bg-default p-4"
      >
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('profile.wishlistVisibility.title') }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ t('profile.wishlistVisibility.description') }}
          </p>
          <p
            v-if="wishlistVisibilitySaved"
            class="mt-1 text-sm text-success"
          >
            {{ t('common.saved') }}
          </p>
        </div>
        <USwitch
          v-model="wishlistPublic"
          :disabled="isSavingWishlistVisibility"
          :aria-label="t('profile.wishlistVisibility.title')"
        />
      </section>

      <section
        id="settings"
        class="rounded-md border border-default bg-default p-4"
      >
        <h2 class="text-base font-semibold text-highlighted">
          {{ t('profile.settings.title') }}
        </h2>
        <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <label
              for="profile-locale"
              class="text-sm font-medium text-highlighted"
            >
              {{ t('app.localeSwitch.label') }}
            </label>
            <p class="mt-1 text-sm text-muted">
              {{ t('profile.settings.languageDescription') }}
            </p>
            <p
              v-if="localeSaved"
              class="mt-1 text-sm text-success"
            >
              {{ t('common.saved') }}
            </p>
          </div>
          <LayoutLocaleSwitch
            id="profile-locale"
            class="shrink-0"
            @saved="onLocaleSaved"
          />
        </div>
        <div class="mt-4 flex flex-col gap-3 border-t border-muted pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <label
              for="profile-card-locale"
              class="text-sm font-medium text-highlighted"
            >
              {{ t('profile.settings.cardLanguage') }}
            </label>
            <p class="mt-1 text-sm text-muted">
              {{ t('profile.settings.cardLanguageDescription') }}
            </p>
            <p
              v-if="cardLocaleSaved"
              class="mt-1 text-sm text-success"
            >
              {{ t('common.saved') }}
            </p>
          </div>
          <USelect
            id="profile-card-locale"
            :model-value="cardLocaleChoice ?? CARD_LOCALE_FOLLOW"
            :items="cardLocaleItems"
            :disabled="isSavingCardLocale"
            :aria-label="t('profile.settings.cardLanguage')"
            class="w-full shrink-0 sm:w-64"
            @update:model-value="onCardLocaleChange"
          />
        </div>
      </section>

      <SharingShareModal
        v-model:open="isShareOpen"
        resource-type="inventory"
        resource-id="me"
        :resource-name="t('profile.inventoryShare.resourceName')"
        :share-path="`/players/${profile.handle}/inventory`"
        @updated="onShareUpdated"
      />
    </template>
  </div>
</template>
