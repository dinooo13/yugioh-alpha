<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center gap-2.5">
        <div class="flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
          Y
        </div>
        <span class="text-lg font-semibold text-gray-900">yugioh alpha</span>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <slot />
      </div>
    </div>
  </div>
</template>
