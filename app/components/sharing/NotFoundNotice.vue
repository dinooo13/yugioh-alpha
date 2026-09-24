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
  <div class="rounded-md border border-default bg-default px-6 py-12 text-center">
    <h1 class="text-lg font-semibold text-highlighted">
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
