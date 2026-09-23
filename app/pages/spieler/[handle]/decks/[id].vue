<script setup lang="ts">
import { pluralize } from '~~/shared/plural'
import type { SharedDeckView } from '~~/shared/sharing'

definePageMeta({ layout: 'public' })

const route = useRoute()

const { data, error } = await useFetch<SharedDeckView>(
  () => `/api/profiles/${route.params.handle}/decks/${route.params.id}`,
  {
    query: computed(() => ({ token: route.query.token || undefined })),
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  },
)

useHead({
  title: computed(() => `${data.value?.deck.name ?? 'Deck'} – yugioh alpha`),
  meta: [
    { name: 'referrer', content: 'no-referrer' },
    { name: 'robots', content: 'noindex, nofollow' },
  ],
})
</script>

<template>
  <div class="space-y-6">
    <SharingNotFoundNotice v-if="error" />

    <template v-else-if="data">
      <div>
        <LayoutBackLink
          :to="`/spieler/${route.params.handle}`"
          label="Zurück zum Profil"
        />
      </div>

      <LayoutPageHeader
        :title="data.deck.name"
        :description="`Geteilt von ${data.owner.displayName}`"
        truncate
      >
        <p
          v-if="data.deck.description"
          class="mt-1 max-w-prose text-sm text-gray-500"
        >
          {{ data.deck.description }}
        </p>
        <p class="mt-1 text-sm text-gray-500">
          {{ pluralize(data.counts.total, 'Karte', 'Karten') }} insgesamt · Nur ansehen
        </p>

        <template
          v-if="data.isOwner"
          #actions
        >
          <UButton
            icon="i-lucide-pencil"
            label="Bearbeiten"
            :to="`/decks/${route.params.id}`"
          />
        </template>
      </LayoutPageHeader>

      <section
        v-if="data.format"
        class="rounded-md border border-gray-200 bg-white p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold text-gray-900">
            {{ data.format.name }}
          </h2>
          <UBadge
            v-if="data.validation"
            :color="data.validation.legal ? 'success' : 'error'"
            variant="subtle"
            :label="data.validation.legal ? 'Legal' : 'Nicht legal'"
            aria-label="Legalität"
          />
        </div>

        <!--
          The issues behind "Nicht legal" ARE delivered to every viewer (see
          `SharedDeckView.validation` / server/utils/shared-views.ts) — a
          guest previously saw only the bare badge with no way to learn why
          (UX review #21). Collapsed by default so it doesn't compete with
          the badge for attention.
        -->
        <UCollapsible
          v-if="data.validation && !data.validation.legal && data.validation.issues.length > 0"
          class="mt-2"
        >
          <template #default="{ open }">
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              class="tap-target px-0"
              :label="open ? 'Details ausblenden' : 'Details anzeigen'"
              :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            />
          </template>
          <template #content>
            <ul class="mt-2 list-inside list-disc space-y-0.5 text-sm text-red-700">
              <li
                v-for="(issue, index) in data.validation.issues"
                :key="`${issue.code}-${issue.cardId ?? issue.section ?? index}`"
              >
                {{ issue.message }}
              </li>
            </ul>
          </template>
        </UCollapsible>
      </section>

      <!--
        Owner-only: this is deck-building coaching ("your main deck is a bit
        short"), not information a guest can act on (UX review #21).
      -->
      <UAlert
        v-if="data.isOwner && data.warnings.length > 0"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Hinweise zum Deckaufbau"
      >
        <template #description>
          <ul class="list-inside list-disc space-y-0.5">
            <li
              v-for="warning in data.warnings"
              :key="`${warning.code}-${warning.cardId ?? ''}`"
            >
              {{ warning.message }}
            </li>
          </ul>
        </template>
      </UAlert>

      <SharingSharedDeckSections
        :sections="data.sections"
        :counts="data.counts"
      />
    </template>
  </div>
</template>
