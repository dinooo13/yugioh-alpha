/**
 * Initials + color avatars for public profiles (#29).
 *
 * Accounts are email/password only, so there is no uploaded or OAuth picture
 * to show (`user.image` is always null and not exposed) — every avatar is
 * the display name's initials on a color derived from the handle.
 */

/**
 * Up to two initials: the first character of the first and the last word,
 * uppercased. Splits by code point (`Array.from`) so an emoji or other
 * astral-plane character stays whole. `'?'` for a blank name.
 */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return '?'
  }

  const first = Array.from(words[0]!)[0] ?? ''
  const last = words.length > 1 ? Array.from(words[words.length - 1]!)[0] ?? '' : ''
  return `${first}${last}`.toUpperCase()
}

// Literal class strings (not built from a color name) so Tailwind picks them
// up. Every pair is -800 text on a -100 background for contrast; in dark mode
// (and in the always-dark sidebar) -200 text on a translucent -400 fill.
const AVATAR_COLORS = [
  { bg: 'bg-brand-100', text: 'text-brand-800', darkBg: 'dark:bg-brand-400/15', darkText: 'dark:text-brand-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', darkBg: 'dark:bg-emerald-400/15', darkText: 'dark:text-emerald-200' },
  { bg: 'bg-sky-100', text: 'text-sky-800', darkBg: 'dark:bg-sky-400/15', darkText: 'dark:text-sky-200' },
  { bg: 'bg-amber-100', text: 'text-amber-800', darkBg: 'dark:bg-amber-400/15', darkText: 'dark:text-amber-200' },
  { bg: 'bg-rose-100', text: 'text-rose-800', darkBg: 'dark:bg-rose-400/15', darkText: 'dark:text-rose-200' },
  { bg: 'bg-teal-100', text: 'text-teal-800', darkBg: 'dark:bg-teal-400/15', darkText: 'dark:text-teal-200' },
] as const

export type AvatarColorClasses = typeof AVATAR_COLORS[number]

/** A stable color for a seed (the profile handle): same handle, same color, on every page. */
export function avatarColorClasses(seed: string): AvatarColorClasses {
  // djb2-style string hash, kept in the unsigned 32-bit range.
  let hash = 5381
  for (const char of seed) {
    hash = ((hash * 33) ^ char.codePointAt(0)!) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}
