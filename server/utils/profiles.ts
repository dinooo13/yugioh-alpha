import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, ne, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { user, userProfile } from '../db/schema'
import { WISHLIST_VISIBILITIES } from '../../shared/sharing'
import type { OwnProfile, PublicProfileSummary, WishlistVisibility } from '../../shared/sharing'

type Db = ReturnType<typeof useDb>

export const HANDLE_MIN_LENGTH = 3
export const HANDLE_MAX_LENGTH = 30
export const HANDLE_PATTERN = /^[a-z0-9-]+$/
export const DISPLAY_NAME_MAX_LENGTH = 60
export const BIO_MAX_LENGTH = 500

/** Handles that would collide with a top-level route or look official. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin', 'api', 'auth', 'login', 'register', 'profil', 'profile', 'spieler',
  'decks', 'deck', 'inventar', 'katalog', 'formate', 'turniere', 'wunschliste',
  'me', 'neu', 'new', 'static', '_nuxt', 'assets',
])

export interface ProfileUpdateInput {
  handle?: string
  displayName?: string
  bio?: string | null
}

export type ProfileRow = typeof userProfile.$inferSelect

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function conflict(message: string): never {
  throw createError({ statusCode: 409, statusMessage: message })
}

function notFound(message: string): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Escapes SQLite LIKE wildcards so a search term matches literally.
function escapeLikeTerm(term: string): string {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/** Lower-cases, strips diacritics, maps anything outside [a-z0-9] to '-', collapses and trims '-'. */
export function slugifyHandle(input: string): string {
  const withoutDiacritics = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  return withoutDiacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function randomBase36Chars(length: number): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return out
}

export function getProfileByUserId(db: Db, userId: string): ProfileRow | undefined {
  return db.select().from(userProfile).where(eq(userProfile.userId, userId)).get()
}

/** Case-insensitive on the caller side: the handle is lower-cased before lookup. */
export function getProfileByHandle(db: Db, handle: string): ProfileRow | undefined {
  return db.select().from(userProfile).where(eq(userProfile.handle, handle.toLowerCase())).get()
}

/** 404 'Profile not found' when the handle is unknown. */
export function requireProfileByHandle(db: Db, handle: string): ProfileRow {
  const row = getProfileByHandle(db, handle)
  if (!row) {
    notFound('Profile not found')
  }
  return row
}

/**
 * Returns the caller's profile row, creating it on first call.
 * Handle: slugifyHandle(user.name) truncated to 24 chars (fallback 'spieler'), plus
 * '-' + 4 base36 random chars; retried up to 10× on collision, then a uuid-derived suffix.
 * displayName defaults to user.name, bio to null, both visibilities to 'private'.
 * Idempotent and safe to call on every request.
 */
export function ensureProfile(db: Db, userId: string): ProfileRow {
  const existing = getProfileByUserId(db, userId)
  if (existing) {
    return existing
  }

  const userRow = db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, userId)).get()
  const name = userRow?.name?.trim() ?? ''
  const base = slugifyHandle(name).slice(0, 24) || 'spieler'

  let handle: string | undefined
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${base}-${randomBase36Chars(4)}`
    if (!getProfileByHandle(db, candidate)) {
      handle = candidate
      break
    }
  }
  if (!handle) {
    handle = `${base}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
  }

  const now = new Date()
  const [created] = db
    .insert(userProfile)
    .values({
      userId,
      handle,
      displayName: name || 'Spieler',
      bio: null,
      inventoryVisibility: 'private',
      inventoryShareToken: null,
      wishlistVisibility: 'private',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all()

  return created!
}

/**
 * 400 'handle must be 3-30 characters of a-z, 0-9 and -'  (pattern/length)
 * 400 'handle is reserved'                                 (RESERVED_HANDLES)
 * 400 'displayName is required'                            (empty after trim)
 * 400 'displayName must be at most 60 characters'
 * 400 'bio must be at most 500 characters'
 * Unknown keys are ignored, mirroring validateDeckUpdateInput.
 */
export function validateProfileUpdateInput(body: unknown): ProfileUpdateInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const input: ProfileUpdateInput = {}

  if (body.handle !== undefined) {
    if (typeof body.handle !== 'string') {
      badRequest('handle must be 3-30 characters of a-z, 0-9 and -')
    }
    // Uppercase is rejected outright (HANDLE_PATTERN only allows a-z), not
    // silently normalized — the URL identity should look exactly like what
    // the user typed and confirmed.
    const handle = body.handle.trim()
    if (
      handle.length < HANDLE_MIN_LENGTH
      || handle.length > HANDLE_MAX_LENGTH
      || !HANDLE_PATTERN.test(handle)
    ) {
      badRequest('handle must be 3-30 characters of a-z, 0-9 and -')
    }
    if (RESERVED_HANDLES.has(handle)) {
      badRequest('handle is reserved')
    }
    input.handle = handle
  }

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      badRequest('displayName is required')
    }
    const displayName = body.displayName.trim()
    if (displayName === '') {
      badRequest('displayName is required')
    }
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      badRequest(`displayName must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`)
    }
    input.displayName = displayName
  }

  if (body.bio !== undefined) {
    if (body.bio === null) {
      input.bio = null
    }
    else {
      if (typeof body.bio !== 'string') {
        badRequest('bio must be at most 500 characters')
      }
      const trimmed = body.bio.trim()
      if (trimmed.length > BIO_MAX_LENGTH) {
        badRequest(`bio must be at most ${BIO_MAX_LENGTH} characters`)
      }
      input.bio = trimmed === '' ? null : trimmed
    }
  }

  return input
}

/** 409 'A player with this handle already exists' on a taken handle (excluding self). */
export function updateProfile(db: Db, userId: string, patch: ProfileUpdateInput): ProfileRow {
  const current = ensureProfile(db, userId)

  if (patch.handle !== undefined && patch.handle !== current.handle) {
    const existing = getProfileByHandle(db, patch.handle)
    if (existing && existing.userId !== userId) {
      conflict('A player with this handle already exists')
    }
  }

  const now = new Date()
  const [updated] = db
    .update(userProfile)
    .set({
      handle: patch.handle ?? current.handle,
      displayName: patch.displayName ?? current.displayName,
      bio: patch.bio !== undefined ? patch.bio : current.bio,
      updatedAt: now,
    })
    .where(eq(userProfile.userId, userId))
    .returning()
    .all()

  return updated!
}

export interface UserSearchItem { userId: string, handle: string, displayName: string }

/**
 * Prefix search over handle and displayName for the "share with selected users"
 * picker. Excludes the caller. Returns [] for a term shorter than 2 chars
 * (never an unfiltered user dump). Hard limit 10. Never returns emails.
 * Users without a profile row are invisible to search — acceptable, they have
 * never opened the app since Phase 6 and could not receive a share anyway.
 */
export function searchUsers(db: Db, viewerUserId: string, q: string, limit = 10): UserSearchItem[] {
  const term = q.trim()
  if (term.length < 2) {
    return []
  }

  const pattern = `${escapeLikeTerm(term.toLowerCase())}%`
  const cappedLimit = Math.min(Math.max(1, limit), 10)

  return db
    .select({ userId: userProfile.userId, handle: userProfile.handle, displayName: userProfile.displayName })
    .from(userProfile)
    .where(and(
      ne(userProfile.userId, viewerUserId),
      or(
        sql`${userProfile.handle} LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(${userProfile.displayName}) LIKE ${pattern} ESCAPE '\\'`,
      ),
    ))
    .orderBy(userProfile.displayName)
    .limit(cappedLimit)
    .all()
}

/** Wire projection: { handle, displayName, bio }. */
export function toPublicProfile(row: ProfileRow): PublicProfileSummary {
  return { handle: row.handle, displayName: row.displayName, bio: row.bio }
}

/** 400 'visibility must be one of private, public'. */
export function validateWishlistVisibility(value: unknown): WishlistVisibility {
  if (typeof value !== 'string' || !(WISHLIST_VISIBILITIES as readonly string[]).includes(value)) {
    badRequest('visibility must be one of private, public')
  }
  return value as WishlistVisibility
}

export function updateWishlistVisibility(db: Db, userId: string, visibility: WishlistVisibility): ProfileRow {
  ensureProfile(db, userId)

  const [updated] = db
    .update(userProfile)
    .set({ wishlistVisibility: visibility, updatedAt: new Date() })
    .where(eq(userProfile.userId, userId))
    .returning()
    .all()

  return updated!
}

/** Wire projection for GET/PATCH /api/profile and the wishlist-visibility endpoint. */
export function toOwnProfile(row: ProfileRow): OwnProfile {
  return {
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    inventoryVisibility: row.inventoryVisibility,
    wishlistVisibility: row.wishlistVisibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
