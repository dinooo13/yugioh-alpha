<script setup lang="ts">
const { t } = useI18n()

const POINTS = ['inventory', 'decks', 'tournaments'] as const
</script>

<template>
  <div class="arena-canvas grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
    <!-- The arena (ADR 0016): desktop only; phones get the strip below. -->
    <div class="arena-surface relative hidden flex-col gap-8 overflow-hidden border-e border-default p-12 lg:flex xl:p-16">
      <LayoutBrandMark
        size="lg"
        class="relative z-10 self-start"
      />

      <div
        class="relative flex min-h-64 flex-1 items-center justify-center"
        aria-hidden="true"
      >
        <LayoutArcaneRings class="absolute top-1/2 left-1/2 aspect-square h-full max-h-[32rem] -translate-x-1/2 -translate-y-1/2" />
        <LayoutCardFan card-class="w-24 xl:w-28" />
      </div>

      <div class="relative z-10 max-w-md">
        <p class="font-display text-[clamp(1.75rem,1.1rem+1.6vw,2.5rem)] leading-tight font-semibold text-highlighted">
          {{ t('auth.hero.tagline') }}
        </p>
        <ul class="mt-6 space-y-3">
          <li
            v-for="point in POINTS"
            :key="point"
            class="flex items-start gap-3 text-sm leading-6 text-toned"
          >
            <span
              class="mt-2 size-2 shrink-0 rotate-45 bg-secondary shadow-glow-gold"
              aria-hidden="true"
            />
            {{ t(`auth.hero.points.${point}`) }}
          </li>
        </ul>
      </div>

      <div
        class="gold-hairline-y absolute inset-y-0 -right-px"
        aria-hidden="true"
      />
    </div>

    <div class="flex min-w-0 flex-col">
      <!-- Phones: a short arena strip with the mark instead of the pane. -->
      <div class="arena-surface relative flex h-36 shrink-0 items-center justify-center overflow-hidden border-b border-default lg:hidden">
        <LayoutArcaneRings
          class="absolute top-1/2 left-1/2 size-80 -translate-x-1/2 -translate-y-1/2"
        />
        <LayoutBrandMark
          size="md"
          class="relative"
        />
        <div
          class="gold-hairline absolute inset-x-0 -bottom-px"
          aria-hidden="true"
        />
      </div>

      <div class="flex items-center justify-end gap-1 px-4 pt-4 sm:px-6">
        <LayoutLocaleSwitch compact />
        <LayoutColorModeToggle />
      </div>

      <main class="flex flex-1 items-start justify-center px-4 pt-2 pb-12 sm:px-6 lg:items-center lg:pt-6">
        <div class="panel w-full max-w-sm p-6 sm:p-8">
          <slot />
        </div>
      </main>

      <!-- Trademark notice (ADR 0018): shown on /login and /register. -->
      <footer class="px-4 pb-6 text-center text-xs leading-5 text-muted sm:px-6">
        <p class="mx-auto max-w-sm">
          {{ t('app.disclaimer') }}
        </p>
      </footer>
    </div>
  </div>
</template>
