<script setup lang="ts">
import { getAuthSession } from '~/utils/session'

// Slim, session-optional shell for /spieler/** (Phase 6 shared views). Unlike
// `default.vue` this never fetches `/api/collections` or renders the owner
// sidebar — both would be meaningless (and 401-noisy) for an anonymous
// visitor. A session only changes the right-hand actions.
const session = ref(await getAuthSession(
  import.meta.server ? useRequestHeaders(['cookie']) : undefined,
))

onMounted(async () => {
  if (!session.value) {
    session.value = await getAuthSession()
  }
})

const route = useRoute()
// Preserved across the login round-trip so a signed-out visitor lands back
// on the shared link they came from (§4.2 #19) instead of the dashboard.
const loginTarget = computed(() => ({ path: '/login', query: { redirect: route.fullPath } }))
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="border-b border-gray-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <NuxtLink
          :to="session ? '/' : '/login'"
          class="flex items-center gap-2.5"
        >
          <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            Y
          </div>
          <span class="text-base font-semibold text-gray-900">yugioh alpha</span>
        </NuxtLink>

        <div class="flex items-center gap-2">
          <template v-if="session">
            <UButton
              label="Mein Profil"
              icon="i-lucide-user"
              color="neutral"
              variant="ghost"
              to="/profil"
            />
            <UButton
              label="Zur App"
              icon="i-lucide-arrow-right"
              variant="outline"
              color="neutral"
              to="/"
            />
          </template>
          <UButton
            v-else
            label="Anmelden"
            icon="i-lucide-log-in"
            :to="loginTarget"
          />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>
