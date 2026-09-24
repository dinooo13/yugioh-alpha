<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()

const isMobileNavOpen = ref(false)

// Closes the mobile drawer on every navigation (nav item, "Profil", …)
// instead of teaching every link inside LayoutSidebarContent to do it
// individually.
watch(() => route.fullPath, () => {
  isMobileNavOpen.value = false
})
</script>

<template>
  <div class="arena-canvas flex min-h-dvh flex-col lg:flex-row">
    <LayoutSkipLink />

    <!-- 56px tall (h-14): assistant/[id].vue sizes the chat against it. -->
    <header class="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-default bg-default/80 px-4 backdrop-blur-md lg:hidden">
      <LayoutBrandMark to="/" />
      <UButton
        icon="i-lucide-menu"
        color="neutral"
        variant="ghost"
        :aria-label="t('app.header.openMenu')"
        class="tap-target"
        @click="() => { isMobileNavOpen = true }"
      />
      <div
        class="gold-hairline absolute inset-x-0 -bottom-px"
        aria-hidden="true"
      />
    </header>

    <aside class="arena-surface sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-default lg:flex">
      <div class="px-5 pt-6 pb-5">
        <LayoutBrandMark to="/" />
      </div>

      <LayoutSidebarContent />

      <div
        class="gold-hairline-y absolute inset-y-0 -right-px"
        aria-hidden="true"
      />
    </aside>

    <USlideover
      v-model:open="isMobileNavOpen"
      side="left"
      :title="t('app.header.menu')"
      class="lg:hidden"
      :ui="{
        content: 'arena-surface max-w-72',
        header: 'border-b border-default',
        title: 'font-display text-lg tracking-[0.04em] text-highlighted',
        body: 'flex flex-col p-0 sm:p-0',
      }"
    >
      <template #body>
        <LayoutSidebarContent />
      </template>
    </USlideover>

    <main
      id="main-content"
      tabindex="-1"
      class="min-w-0 flex-1 p-4 focus:outline-none lg:p-8"
    >
      <slot />
    </main>

    <LayoutConfirmDialog />
  </div>
</template>
