export default defineAppConfig({
  ui: {
    colors: {
      primary: 'brand',
      neutral: 'slate',
    },
    button: {
      // The default `disabled:opacity-75` reads almost identically to an
      // active button (UX review #13, most visible on the deck editor's
      // `size="xs"` section buttons) — make disabled unmistakably inert.
      slots: {
        base: 'disabled:opacity-40 disabled:grayscale',
      },
    },
  },
})
