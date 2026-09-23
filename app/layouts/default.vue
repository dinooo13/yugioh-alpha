<script setup lang="ts">
const route = useRoute()

const isMobileNavOpen = ref(false)

// Closes the mobile drawer on every navigation (nav item, collection link,
// "Profil", …) instead of teaching every link inside LayoutSidebarContent to
// do it individually.
watch(() => route.fullPath, () => {
  isMobileNavOpen.value = false
})
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-gray-50 lg:flex-row">
    <header class="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
      <NuxtLink
        to="/"
        class="flex items-center gap-2.5"
      >
        <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
          Y
        </div>
        <span class="text-base font-semibold text-gray-900">yugioh alpha</span>
      </NuxtLink>
      <UButton
        icon="i-lucide-menu"
        color="neutral"
        variant="ghost"
        aria-label="Menü öffnen"
        @click="() => { isMobileNavOpen = true }"
      />
    </header>

    <aside class="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
      <NuxtLink
        to="/"
        class="flex items-center gap-2.5 px-5 py-5"
      >
        <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
          Y
        </div>
        <span class="text-base font-semibold text-gray-900">yugioh alpha</span>
      </NuxtLink>

      <LayoutSidebarContent />
    </aside>

    <USlideover
      v-model:open="isMobileNavOpen"
      side="left"
      title="Menü"
      class="lg:hidden"
    >
      <template #body>
        <LayoutSidebarContent />
      </template>
    </USlideover>

    <main class="min-w-0 flex-1 p-4 lg:p-8">
      <slot />
    </main>

    <LayoutConfirmDialog />
  </div>
</template>
