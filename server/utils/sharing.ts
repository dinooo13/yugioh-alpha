import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { useDb } from '../db'
import { collection, deck, shareGrant, user, userProfile } from '../db/schema'
import { ensureProfile, getProfileByUserId } from './profiles'
import type { ProfileRow } from './profiles'
import { SHARE_RESOURCE_TYPES, VISIBILITIES } from '../../shared/sharing'
import type { ShareGrantItem, ShareResourceType, ShareState, Visibility } from '../../shared/sharing'

type Db = ReturnType<typeof useDb>

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function notFound(message: string): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export interface ShareTarget {
  resourceType: ShareResourceType
  resourceId: string
  ownerUserId: string
  visibility: Visibility
  shareToken: string | null
}

export type ShareAccessVia = 'owner' | 'public' | 'grant' | 'token'

export interface ShareAccess {
  allowed: boolean
  isOwner: boolean
  via: ShareAccessVia | null
}

/** 22-char URL-safe token: randomBytes(16).toString('base64url'). */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Constant-time compare, length-guarded (timingSafeEqual throws on length mismatch). */
export function tokensMatch(stored: string | null, provided: string | undefined): boolean {
  if (!stored || !provided) {
    return false
  }

  const storedBuffer = Buffer.from(stored)
  const providedBuffer = Buffer.from(provided)
  if (storedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(storedBuffer, providedBuffer)
}

/** 400 'visibility must be one of private, link, public'. */
export function validateVisibility(value: unknown): Visibility {
  if (typeof value !== 'string' || !(VISIBILITIES as readonly string[]).includes(value)) {
    badRequest('visibility must be one of private, link, public')
  }
  return value as Visibility
}

export interface ShareUpdateInput { visibility?: Visibility, regenerateToken?: boolean }

/**
 * 400 'Request body must be an object'
 * 400 'visibility must be one of private, link, public'
 * 400 'regenerateToken must be a boolean'
 * 400 'Nothing to update' when neither field is present.
 */
export function validateShareUpdateInput(body: unknown): ShareUpdateInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const input: ShareUpdateInput = {}

  if (body.visibility !== undefined) {
    input.visibility = validateVisibility(body.visibility)
  }

  if (body.regenerateToken !== undefined) {
    if (typeof body.regenerateToken !== 'boolean') {
      badRequest('regenerateToken must be a boolean')
    }
    input.regenerateToken = body.regenerateToken
  }

  if (input.visibility === undefined && input.regenerateToken === undefined) {
    badRequest('Nothing to update')
  }

  return input
}

/**
 * THE access rule. Viewer sees the resource iff any of:
 *   1. viewerUserId === target.ownerUserId                      -> 'owner'
 *   2. target.visibility === 'public'                           -> 'public'
 *   3. viewerUserId != null && a share_grant row exists         -> 'grant'
 *   4. token matches target.shareToken (token non-null)         -> 'token'
 * A token is only ever consulted while visibility === 'link' — 'public' is
 * already allowed unconditionally by rule 2 (so rule 4's token check is
 * unreachable for it), and 'private' nulls the token in setShareState, so
 * rule 4 can never fire there either.
 * Evaluation order above is also the reported `via`.
 */
export function resolveAccess(
  db: Db,
  target: ShareTarget,
  viewerUserId: string | null,
  token?: string,
): ShareAccess {
  if (viewerUserId != null && viewerUserId === target.ownerUserId) {
    return { allowed: true, isOwner: true, via: 'owner' }
  }

  if (target.visibility === 'public') {
    return { allowed: true, isOwner: false, via: 'public' }
  }

  if (viewerUserId != null) {
    const grant = db
      .select({ id: shareGrant.id })
      .from(shareGrant)
      .where(and(
        eq(shareGrant.resourceType, target.resourceType),
        eq(shareGrant.resourceId, target.resourceId),
        eq(shareGrant.grantedUserId, viewerUserId),
      ))
      .get()

    if (grant) {
      return { allowed: true, isOwner: false, via: 'grant' }
    }
  }

  if (target.visibility === 'link' && tokensMatch(target.shareToken, token)) {
    return { allowed: true, isOwner: false, via: 'token' }
  }

  return { allowed: false, isOwner: false, via: null }
}

/**
 * Loads the deck row and applies resolveAccess. Throws 404 'Deck not found'
 * when the deck does not exist OR the viewer may not see it — never 403, so a
 * private deck is indistinguishable from a missing one (ADR 0004 boundary).
 * `expectedOwnerUserId` (from the /spieler/:handle segment) must match
 * deck.userId, otherwise 404 as well.
 */
export function requireViewableDeck(
  db: Db,
  viewerUserId: string | null,
  deckId: string,
  opts: { token?: string, expectedOwnerUserId?: string } = {},
): { row: typeof deck.$inferSelect, access: ShareAccess } {
  const row = db.select().from(deck).where(eq(deck.id, deckId)).get()
  if (!row) {
    notFound('Deck not found')
  }
  if (opts.expectedOwnerUserId !== undefined && row.userId !== opts.expectedOwnerUserId) {
    notFound('Deck not found')
  }

  const target: ShareTarget = {
    resourceType: 'deck',
    resourceId: row.id,
    ownerUserId: row.userId,
    visibility: row.visibility,
    shareToken: row.shareToken,
  }
  const access = resolveAccess(db, target, viewerUserId, opts.token)
  if (!access.allowed) {
    notFound('Deck not found')
  }

  return { row, access }
}

/** Same contract, 404 'Collection not found'. */
export function requireViewableCollection(
  db: Db,
  viewerUserId: string | null,
  collectionId: string,
  opts: { token?: string, expectedOwnerUserId?: string } = {},
): { row: typeof collection.$inferSelect, access: ShareAccess } {
  const row = db.select().from(collection).where(eq(collection.id, collectionId)).get()
  if (!row) {
    notFound('Collection not found')
  }
  if (opts.expectedOwnerUserId !== undefined && row.userId !== opts.expectedOwnerUserId) {
    notFound('Collection not found')
  }

  const target: ShareTarget = {
    resourceType: 'collection',
    resourceId: row.id,
    ownerUserId: row.userId,
    visibility: row.visibility,
    shareToken: row.shareToken,
  }
  const access = resolveAccess(db, target, viewerUserId, opts.token)
  if (!access.allowed) {
    notFound('Collection not found')
  }

  return { row, access }
}

/**
 * Whole-inventory access, driven by user_profile.inventoryVisibility /
 * inventoryShareToken and grants with resourceType 'inventory',
 * resourceId = ownerUserId. 404 'Inventory not found' when not allowed.
 */
export function requireViewableInventory(
  db: Db,
  viewerUserId: string | null,
  ownerUserId: string,
  opts: { token?: string } = {},
): { profile: ProfileRow, access: ShareAccess } {
  const profile = getProfileByUserId(db, ownerUserId)
  if (!profile) {
    notFound('Inventory not found')
  }

  const target: ShareTarget = {
    resourceType: 'inventory',
    resourceId: ownerUserId,
    ownerUserId,
    visibility: profile.inventoryVisibility,
    shareToken: profile.inventoryShareToken,
  }
  const access = resolveAccess(db, target, viewerUserId, opts.token)
  if (!access.allowed) {
    notFound('Inventory not found')
  }

  return { profile, access }
}

type LoadedShareable =
  | { kind: 'deck', row: typeof deck.$inferSelect }
  | { kind: 'collection', row: typeof collection.$inferSelect }
  | { kind: 'inventory', row: ProfileRow }

// Owner-side load: 404 when the resource is not the caller's. For 'inventory'
// this lazily creates the profile (an owner-side sharing write/read always
// may, see server/utils/profiles.ts ensureProfile).
function loadShareableRow(db: Db, ownerUserId: string, type: ShareResourceType, resourceId: string): LoadedShareable {
  if (type === 'deck') {
    const row = db.select().from(deck).where(and(eq(deck.id, resourceId), eq(deck.userId, ownerUserId))).get()
    if (!row) {
      notFound('Deck not found')
    }
    return { kind: 'deck', row }
  }

  if (type === 'collection') {
    const row = db.select().from(collection).where(and(eq(collection.id, resourceId), eq(collection.userId, ownerUserId))).get()
    if (!row) {
      notFound('Collection not found')
    }
    return { kind: 'collection', row }
  }

  if (resourceId !== ownerUserId) {
    notFound('Inventory not found')
  }
  return { kind: 'inventory', row: ensureProfile(db, ownerUserId) }
}

function currentVisibilityAndToken(loaded: LoadedShareable): { visibility: Visibility, shareToken: string | null } {
  if (loaded.kind === 'inventory') {
    return { visibility: loaded.row.inventoryVisibility, shareToken: loaded.row.inventoryShareToken }
  }
  return { visibility: loaded.row.visibility, shareToken: loaded.row.shareToken }
}

/** Owner-side lookups. All of these 404 when the caller is not the owner. */
export function getShareState(db: Db, ownerUserId: string, type: ShareResourceType, resourceId: string): ShareState {
  const loaded = loadShareableRow(db, ownerUserId, type, resourceId)
  const { visibility, shareToken } = currentVisibilityAndToken(loaded)

  return {
    resourceType: type,
    resourceId,
    visibility,
    shareToken,
    grants: listShareGrants(db, ownerUserId, type, resourceId),
  }
}

/**
 * Token lifecycle (exactly):
 *   -> 'link'    : ensure a token exists (create if NULL)
 *   -> 'public'  : ensure a token exists (so "Link kopieren" always works)
 *   -> 'private' : token set to NULL, invalidating every previously copied link
 *   regenerateToken: true -> new random token; 400 'Cannot create a link for a
 *                    private resource' when the resulting visibility is 'private'
 * For 'inventory' the columns live on user_profile; for deck/collection on the row.
 * Bumps updatedAt on the affected row.
 */
export function setShareState(
  db: Db,
  ownerUserId: string,
  type: ShareResourceType,
  resourceId: string,
  input: ShareUpdateInput,
): ShareState {
  const loaded = loadShareableRow(db, ownerUserId, type, resourceId)
  const { visibility: currentVisibility, shareToken: currentToken } = currentVisibilityAndToken(loaded)

  const nextVisibility = input.visibility ?? currentVisibility

  if (input.regenerateToken && nextVisibility === 'private') {
    badRequest('Cannot create a link for a private resource')
  }

  const nextToken = nextVisibility === 'private'
    ? null
    : input.regenerateToken
      ? generateShareToken()
      : (currentToken ?? generateShareToken())

  const now = new Date()

  if (loaded.kind === 'deck') {
    db.update(deck).set({ visibility: nextVisibility, shareToken: nextToken, updatedAt: now }).where(eq(deck.id, loaded.row.id)).run()
  }
  else if (loaded.kind === 'collection') {
    db.update(collection).set({ visibility: nextVisibility, shareToken: nextToken, updatedAt: now }).where(eq(collection.id, loaded.row.id)).run()
  }
  else {
    db.update(userProfile)
      .set({ inventoryVisibility: nextVisibility, inventoryShareToken: nextToken, updatedAt: now })
      .where(eq(userProfile.userId, ownerUserId))
      .run()
  }

  return getShareState(db, ownerUserId, type, resourceId)
}

/**
 * 404 when the resource is not the caller's.
 * 400 'You cannot share a resource with yourself' when grantedUserId === ownerUserId.
 * 404 'Player not found' when grantedUserId has no user row.
 * Idempotent: an existing grant is returned, not duplicated (unique index).
 */
export function addShareGrant(
  db: Db,
  ownerUserId: string,
  type: ShareResourceType,
  resourceId: string,
  grantedUserId: string,
): ShareState {
  loadShareableRow(db, ownerUserId, type, resourceId)

  if (grantedUserId === ownerUserId) {
    badRequest('You cannot share a resource with yourself')
  }

  const grantedUserRow = db.select({ id: user.id }).from(user).where(eq(user.id, grantedUserId)).get()
  if (!grantedUserRow) {
    notFound('Player not found')
  }

  // A user can exist without ever having visited a page that lazily creates
  // their user_profile row; without this, ShareGrantItem.handle (which
  // left-joins user_profile) would render as '@' for such a grantee.
  ensureProfile(db, grantedUserId)

  const existing = db
    .select({ id: shareGrant.id })
    .from(shareGrant)
    .where(and(
      eq(shareGrant.resourceType, type),
      eq(shareGrant.resourceId, resourceId),
      eq(shareGrant.grantedUserId, grantedUserId),
    ))
    .get()

  if (!existing) {
    db.insert(shareGrant).values({
      id: randomUUID(),
      resourceType: type,
      resourceId,
      ownerUserId,
      grantedUserId,
      createdAt: new Date(),
    }).run()
  }

  return getShareState(db, ownerUserId, type, resourceId)
}

/** 404 'Share not found' when no such grant. */
export function removeShareGrant(
  db: Db,
  ownerUserId: string,
  type: ShareResourceType,
  resourceId: string,
  grantedUserId: string,
): ShareState {
  loadShareableRow(db, ownerUserId, type, resourceId)

  const deleted = db
    .delete(shareGrant)
    .where(and(
      eq(shareGrant.resourceType, type),
      eq(shareGrant.resourceId, resourceId),
      eq(shareGrant.grantedUserId, grantedUserId),
    ))
    .returning({ id: shareGrant.id })
    .all()

  if (deleted.length === 0) {
    notFound('Share not found')
  }

  return getShareState(db, ownerUserId, type, resourceId)
}

export function listShareGrants(db: Db, ownerUserId: string, type: ShareResourceType, resourceId: string): ShareGrantItem[] {
  const rows = db
    .select({
      userId: shareGrant.grantedUserId,
      createdAt: shareGrant.createdAt,
      handle: userProfile.handle,
      displayName: userProfile.displayName,
      fallbackName: user.name,
    })
    .from(shareGrant)
    .innerJoin(user, eq(user.id, shareGrant.grantedUserId))
    .leftJoin(userProfile, eq(userProfile.userId, shareGrant.grantedUserId))
    .where(and(
      eq(shareGrant.resourceType, type),
      eq(shareGrant.resourceId, resourceId),
      eq(shareGrant.ownerUserId, ownerUserId),
    ))
    .orderBy(shareGrant.createdAt)
    .all()

  return rows.map(row => ({
    userId: row.userId,
    handle: row.handle ?? '',
    displayName: row.displayName ?? row.fallbackName,
    createdAt: row.createdAt.toISOString(),
  }))
}

/** Cleanup for the polymorphic FK-less resourceId. Call from deleteDeck / deleteCollection. */
export function deleteGrantsForResource(db: Db, type: ShareResourceType, resourceId: string): void {
  db.delete(shareGrant).where(and(eq(shareGrant.resourceType, type), eq(shareGrant.resourceId, resourceId))).run()
}

/** Ids of resources of one type the viewer holds a grant for — powers the profile listing. */
export function grantedResourceIds(db: Db, viewerUserId: string | null, ownerUserId: string, type: ShareResourceType): Set<string> {
  if (!viewerUserId) {
    return new Set()
  }

  const rows = db
    .select({ resourceId: shareGrant.resourceId })
    .from(shareGrant)
    .where(and(
      eq(shareGrant.resourceType, type),
      eq(shareGrant.ownerUserId, ownerUserId),
      eq(shareGrant.grantedUserId, viewerUserId),
    ))
    .all()

  return new Set(rows.map(row => row.resourceId))
}

/** 400 'resourceType must be one of deck, collection, inventory'. */
export function validateShareResourceType(value: unknown): ShareResourceType {
  if (typeof value !== 'string' || !(SHARE_RESOURCE_TYPES as readonly string[]).includes(value)) {
    badRequest('resourceType must be one of deck, collection, inventory')
  }
  return value as ShareResourceType
}

/** Resolves the 'me' alias for inventory; 404 when a caller passes a foreign user id. */
export function resolveResourceId(type: ShareResourceType, raw: string, callerUserId: string): string {
  if (type !== 'inventory') {
    return raw
  }
  if (raw === 'me' || raw === callerUserId) {
    return callerUserId
  }
  notFound('Inventory not found')
}
