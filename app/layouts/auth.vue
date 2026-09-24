<template>
  <div class="arena-canvas flex min-h-screen items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center gap-2.5">
        <LayoutBrandMark size="md" />
      </div>
      <div class="panel p-6">
        <slot />
      </div>
      <div class="mt-4 flex items-center justify-center gap-1">
        <LayoutLocaleSwitch compact />
        <LayoutColorModeToggle size="sm" />
      </div>
    </div>
  </div>
</template>
