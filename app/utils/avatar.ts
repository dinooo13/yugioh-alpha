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
// up. Every pair is -800 text on a -100 background for contrast.
const AVATAR_COLORS = [
  { bg: 'bg-brand-100', text: 'text-brand-800' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  { bg: 'bg-sky-100', text: 'text-sky-800' },
  { bg: 'bg-amber-100', text: 'text-amber-800' },
  { bg: 'bg-rose-100', text: 'text-rose-800' },
  { bg: 'bg-teal-100', text: 'text-teal-800' },
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
