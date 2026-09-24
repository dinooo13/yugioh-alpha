<script setup lang="ts">
import { getAuthSession } from '~/utils/session'

// Shared by all four `/players/**` pages (profile, inventory, deck,
// collection): every not-found/no-access case renders exactly this box
// (ADR 0004 — a wrong handle, a missing/expired/wrong token and a revoked
// grant must be indistinguishable). Duplicated as inline markup across the
// four pages before this extraction (UX review #19/#21 follow-up).
//
// A grant is user-bound: a signed-out visitor who was in fact granted access
// still sees this box, which reads exactly like "you don't belong here".
// The login hint below (only for anonymous visitors — a logged-in viewer
// truly has no access) softens that and carries the current URL through the
// login round-trip so they land back here, not on the dashboard.
const route = useRoute()
const { t } = useI18n()

const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
})

const loginTarget = computed(() => ({ path: '/login', query: { redirect: route.fullPath } }))
</script>

<template>
  <div class="panel px-6 py-12 text-center">
    <div
      class="relative mx-auto mb-5 flex size-16 items-center justify-center"
      aria-hidden="true"
    >
      <span class="absolute inset-0 rounded-full border border-dashed border-secondary/45 motion-safe:animate-[spin_40s_linear_infinite]" />
      <span class="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
        <UIcon
          name="i-lucide-search-x"
          class="size-6"
        />
      </span>
    </div>
    <h1 class="font-display text-xl font-semibold text-highlighted">
      {{ t('sharing.notFound.title') }}
    </h1>
    <p class="mt-2 text-sm text-muted">
      {{ t('sharing.notFound.description') }}
    </p>
    <i18n-t
      v-if="!session"
      keypath="sharing.notFound.loginHint"
      tag="p"
      scope="global"
      class="mt-4 text-sm text-muted"
    >
      <template #link>
        <NuxtLink
          :to="loginTarget"
          class="font-medium text-primary hover:underline"
        >
          {{ t('sharing.notFound.loginLink') }}
        </NuxtLink>
      </template>
    </i18n-t>
  </div>
</template>
