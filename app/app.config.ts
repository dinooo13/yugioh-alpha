export default defineAppConfig({
  ui: {
    // Duel Arena (docs/adr/0016-visual-design-system.md): arcane violet for
    // actions, Millennium gold for meaning, an indigo-tinted neutral. The
    // light-mode shades are pinned to AA-safe values in main.css.
    colors: {
      primary: 'brand',
      secondary: 'millennium',
      neutral: 'abyss',
      success: 'emerald',
      info: 'sky',
      warning: 'amber',
      error: 'rose',
    },
    button: {
      // The default `disabled:opacity-75` reads almost identically to an
      // active button (UX review #13, most visible on the deck editor's
      // `size="xs"` section buttons) — make disabled unmistakably inert.
      // Focus: a solid ring in the focus color (gold in dark mode) instead of
      // Nuxt UI's 25% tint, which nearly vanishes on the dark canvas.
      slots: {
        base: 'disabled:opacity-40 disabled:grayscale transition-[color,background-color,border-color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-focus)',
      },
      compoundVariants: [
        {
          // Dark mode keeps the saturated arcane violet with white text
          // (4.62:1) instead of Nuxt UI's pale primary-400 fill.
          color: 'primary',
          variant: 'solid',
          class: 'dark:text-on-primary dark:bg-primary-500 dark:hover:bg-primary-600 dark:active:bg-primary-600 dark:disabled:bg-primary-500 dark:aria-disabled:bg-primary-500',
        },
      ],
    },
    modal: {
      slots: {
        overlay: 'bg-scrim backdrop-blur-[2px]',
        content: 'rounded-xl ring-1 ring-default shadow-lift divide-default',
      },
    },
    slideover: {
      slots: {
        overlay: 'bg-scrim backdrop-blur-[2px]',
        content: 'ring-1 ring-default shadow-lift divide-default',
      },
    },
    badge: {
      slots: {
        base: 'font-medium',
      },
    },
  },
})
