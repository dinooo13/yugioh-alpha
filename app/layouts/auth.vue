<template>
  <div class="flex min-h-screen items-center justify-center bg-muted px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center gap-2.5">
        <div class="flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-inverted">
          Y
        </div>
        <span class="text-lg font-semibold text-highlighted">yugioh alpha</span>
      </div>
      <div class="rounded-lg border border-default bg-default p-6 shadow-sm">
        <slot />
      </div>
      <div class="mt-4 flex justify-center">
        <LayoutLocaleSwitch compact />
      </div>
    </div>
  </div>
</template>
