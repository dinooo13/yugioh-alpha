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
        base: 'disabled:opacity-40 disabled:grayscale transition-[color,background-color,border-color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
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
    // Placeholders are text: `text-muted` (4.5:1+) instead of `text-dimmed`
    // (3:1, meant for icons), in both modes.
    // #134: the open menu grows to fit long option names, like set names;
    // the field keeps its width; labels wrap beyond the cap instead of being
    // cut (`text-clip` replaces the theme's `truncate` via tailwind-merge).
    select: {
      slots: {
        placeholder: 'truncate text-muted',
        content: 'w-auto min-w-(--reka-select-trigger-width) max-w-[min(32rem,calc(100vw-2rem))]',
        itemLabel: 'text-clip break-words',
      },
    },
    selectMenu: {
      slots: {
        placeholder: 'truncate text-muted',
        content: 'w-auto min-w-(--reka-combobox-trigger-width) max-w-[min(32rem,calc(100vw-2rem))]',
        itemLabel: 'text-clip break-words',
      },
    },
    inputMenu: {
      slots: {
        content: 'w-auto min-w-(--reka-combobox-trigger-width) max-w-[min(32rem,calc(100vw-2rem))]',
        itemLabel: 'text-clip break-words',
      },
    },
    input: {
      slots: {
        base: 'placeholder:text-muted',
      },
    },
    textarea: {
      slots: {
        base: 'placeholder:text-muted',
      },
    },
    // The assistant's thread (docs/adr/0020-assistant-on-the-ai-sdk.md), in
    // the Duel Arena look of the former hand-made thread: the user's
    // messages in an arcane-violet bubble on the right, the assistant's on
    // the left behind its sparkle avatar. An answer holds text, chips and
    // proposal cards in turn, so its text bubbles are drawn per text part
    // (ChatThread.vue), not around the whole message.
    chatMessages: {
      slots: {
        root: 'gap-4 px-0',
        indicator: '*:bg-primary/50',
        viewport: 'sticky top-auto bottom-2 h-0 z-10',
        autoScroll: 'bottom-2 bg-default shadow-lift',
      },
    },
    chatMessage: {
      slots: {
        leading: 'size-7 shrink-0 rounded-full bg-primary/10 text-primary ring-1 ring-secondary/60',
        content: 'text-sm leading-6',
        files: 'flex-wrap justify-end',
      },
      variants: {
        compact: {
          false: {
            container: 'gap-2.5 pb-0',
            content: 'space-y-2',
            leadingIcon: 'size-3.5',
          },
        },
      },
      compoundVariants: [
        {
          variant: ['solid', 'outline', 'soft', 'subtle'],
          compact: false,
          class: {
            content: 'px-3.5 py-2.5 rounded-2xl min-h-0',
            leading: 'mt-0',
          },
        },
        {
          // The user's messages (ChatThread.vue: `variant: 'solid'`, right).
          variant: 'solid',
          side: 'right',
          class: {
            content: 'bg-primary bg-linear-to-br from-primary-500 to-primary-600 text-on-primary rounded-br-md shadow-sm',
          },
        },
        {
          variant: 'naked',
          side: 'left',
          class: {
            content: 'min-w-0',
          },
        },
      ],
    },
    // Focus comes from Nuxt UI 4.10's built-in highlight (a solid primary
    // ring plus a soft outline while the textarea is focused, like UInput),
    // so the root no longer adds its own `focus-within` ring. 4.10 also
    // zeroed the textarea's inline padding (`base: 'px-0'`); keep it, so the
    // text stays in line with the attach button below it.
    chatPrompt: {
      slots: {
        root: 'bg-elevated/50 ring ring-default rounded-xl',
        base: 'px-2.5',
      },
    },
    chatTool: {
      slots: {
        trigger: 'text-toned text-xs',
        suffix: 'text-muted',
        body: 'text-muted text-xs',
      },
    },
    chatReasoning: {
      slots: {
        trigger: 'text-xs',
        body: 'text-muted text-xs',
      },
    },
  },
})
