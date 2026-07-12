import { and, eq, ne, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import type { useDb } from '../db'
import { collection, ownedCard } from '../db/schema'

type Db = ReturnType<typeof useDb>

export const COLLECTION_NAME_MAX_LENGTH = 60
export const COLLECTION_DESCRIPTION_MAX_LENGTH = 500

export interface CollectionInput {
  name: string
  description: string | null
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function conflict(message: string): never {
  throw createError({ statusCode: 409, statusMessage: message })
}

function notFound(message = 'Collection not found'): never {
  throw createError({ statusCode: 404, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateCollectionInput(body: unknown): CollectionInput {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const rawName = body.name
  if (typeof rawName !== 'string') {
    badRequest('name is required')
  }

  const name = rawName.trim()
  if (name === '') {
    badRequest('name is required')
  }
  if (name.length > COLLECTION_NAME_MAX_LENGTH) {
    badRequest(`name must be at most ${COLLECTION_NAME_MAX_LENGTH} characters`)
  }

  let description: string | null = null
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      badRequest('description must be a string')
    }
    const trimmed = body.description.trim()
    if (trimmed.length > COLLECTION_DESCRIPTION_MAX_LENGTH) {
      badRequest(`description must be at most ${COLLECTION_DESCRIPTION_MAX_LENGTH} characters`)
    }
    description = trimmed === '' ? null : trimmed
  }

  return { name, description }
}

export function validateCollectionUpdateInput(body: unknown): Partial<CollectionInput> {
  if (!isRecord(body)) {
    badRequest('Request body must be an object')
  }

  const input: Partial<CollectionInput> = {}
  if (body.name !== undefined) {
    input.name = validateCollectionInput({ name: body.name }).name
  }
  if (body.description !== undefined) {
    input.description = validateCollectionInput({ name: 'placeholder', description: body.description }).description
  }

  return input
}

function nameCollisionWhere(userId: string, name: string, exceptId?: string) {
  const clauses = [
    eq(collection.userId, userId),
    sql`lower(${collection.name}) = lower(${name})`,
  ]

  if (exceptId) {
    clauses.push(ne(collection.id, exceptId))
  }

  return and(...clauses)
}

export function assertNoNameCollision(db: Db, userId: string, name: string, exceptId?: string) {
  const existing = db.select({ id: collection.id }).from(collection).where(nameCollisionWhere(userId, name, exceptId)).get()
  if (existing) {
    conflict('A collection with this name already exists')
  }
}

export function assertCollectionOwnedByUser(db: Db, userId: string, collectionId: string) {
  const owned = db
    .select({ id: collection.id })
    .from(collection)
    .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
    .get()

  if (!owned) {
    badRequest('collection_id does not reference a collection you own')
  }
}

// Used to scope an inventory read (e.g. ?collectionId=) to a collection the
// user owns. Unlike assertCollectionOwnedByUser (400, used for writes), a
// filter naming a collection the user can't see behaves like a missing
// resource: 404.
export function requireCollectionOwnedByUser(db: Db, userId: string, collectionId: string) {
  const owned = db
    .select({ id: collection.id })
    .from(collection)
    .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
    .get()

  if (!owned) {
    notFound()
  }
}

export async function createCollection(db: Db, userId: string, input: CollectionInput) {
  assertNoNameCollision(db, userId, input.name)

  const now = new Date()
  const [created] = db
    .insert(collection)
    .values({
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all()

  return { ...created!, cardCount: 0 }
}

export async function updateCollection(db: Db, userId: string, id: string, patch: Partial<CollectionInput>) {
  const current = db
    .select()
    .from(collection)
    .where(and(eq(collection.id, id), eq(collection.userId, userId)))
    .get()

  if (!current) {
    notFound()
  }

  const name = patch.name ?? current.name
  const description = patch.description !== undefined ? patch.description : current.description

  if (patch.name !== undefined) {
    assertNoNameCollision(db, userId, name, id)
  }

  const now = new Date()
  const [updated] = db
    .update(collection)
    .set({ name, description, updatedAt: now })
    .where(eq(collection.id, id))
    .returning()
    .all()

  return updated!
}

export async function deleteCollection(db: Db, userId: string, id: string) {
  const deleted = db
    .delete(collection)
    .where(and(eq(collection.id, id), eq(collection.userId, userId)))
    .returning({ id: collection.id })
    .all()

  if (deleted.length === 0) {
    notFound()
  }
}

export function listCollections(db: Db, userId: string) {
  const items = db
    .select({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      cardCount: sql<number>`coalesce(sum(${ownedCard.quantity}), 0)`,
    })
    .from(collection)
    .leftJoin(ownedCard, eq(ownedCard.collectionId, collection.id))
    .where(eq(collection.userId, userId))
    .groupBy(collection.id)
    .orderBy(collection.name)
    .all()

  const allCount = db
    .select({ count: sql<number>`coalesce(sum(${ownedCard.quantity}), 0)` })
    .from(ownedCard)
    .where(eq(ownedCard.userId, userId))
    .get()?.count ?? 0

  return { items, allCount }
}
