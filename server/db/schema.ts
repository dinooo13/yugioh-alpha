import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// Better Auth core tables (email/password only).
// Generated to match Better Auth's expected schema for the Drizzle adapter (provider: "sqlite").
// See: https://www.better-auth.com/docs/adapters/drizzle

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

// Global card catalog (see docs/adr/0001-card-catalog-data-model.md).
//
// The catalog is the canonical, global reference for known Yu-Gi-Oh cards,
// imported from the YGOPRODeck API. It is intentionally separate from any
// user-owned card concept (Roadmap "Key Product Principle"): nothing here
// references `user`, and owned-card tables (a later phase) will reference
// `catalogCard`/`catalogPrinting` instead of the other way around.

export const catalogCard = sqliteTable(
  'catalog_card',
  {
    // YGOPRODeck's card `id` (passcode) — stable, globally unique, and the
    // natural upsert target / FK anchor for owned cards later.
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    frameType: text('frame_type'),
    desc: text('desc').notNull(),
    race: text('race'),
    archetype: text('archetype'),
    attribute: text('attribute'),
    atk: integer('atk'),
    def: integer('def'),
    level: integer('level'),
    linkval: integer('linkval'),
    scale: integer('scale'),
    // Variable-length / rarely-queried extras: kept as JSON rather than
    // dedicated child tables (display/rule metadata, not relational data).
    linkMarkers: text('link_markers', { mode: 'json' }).$type<string[]>(),
    banlistInfo: text('banlist_info', { mode: 'json' }).$type<{
      ban_tcg?: string
      ban_ocg?: string
      ban_goat?: string
    }>(),
    cardPrices: text('card_prices', { mode: 'json' }).$type<Record<string, string>>(),
    // ISO date strings (YGOPRODeck `misc_info[].tcg_date`/`ocg_date`), kept
    // as text and indexed so Phase 4 release-date format rules can filter on them.
    tcgDate: text('tcg_date'),
    ocgDate: text('ocg_date'),
    ygoprodeckUrl: text('ygoprodeck_url'),
    syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
  },
  table => [
    index('idx_catalog_card_name').on(table.name),
    index('idx_catalog_card_type').on(table.type),
    index('idx_catalog_card_attribute').on(table.attribute),
    index('idx_catalog_card_tcg_date').on(table.tcgDate),
  ],
)

// A set is identified by its name (YGOPRODeck's `card_sets[].set_name`);
// `id` is a slug derived from that name (see server/utils/ygoprodeck.ts).
export const catalogSet = sqliteTable('catalog_set', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
})

// A printing is a specific card-in-set appearance (YGOPRODeck `card_sets[]`
// entry): the join between a card and a set, carrying printing-specific
// data. Owned cards will later reference a printing for edition/rarity.
export const catalogPrinting = sqliteTable(
  'catalog_printing',
  {
    // The full per-printing set code (e.g. "SDY-006") is unique across the
    // API and serves as the natural primary key.
    id: text('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => catalogCard.id, { onDelete: 'cascade' }),
    setId: text('set_id')
      .notNull()
      .references(() => catalogSet.id, { onDelete: 'cascade' }),
    setCode: text('set_code').notNull(),
    rarity: text('rarity'),
    price: text('price'),
  },
  table => [
    index('idx_printing_card').on(table.cardId),
    index('idx_printing_set').on(table.setId),
  ],
)

export const catalogCardImage = sqliteTable(
  'catalog_card_image',
  {
    // YGOPRODeck `card_images[].id` — art variant id.
    id: integer('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => catalogCard.id, { onDelete: 'cascade' }),
    imageUrl: text('image_url').notNull(),
    imageUrlSmall: text('image_url_small'),
    imageUrlCropped: text('image_url_cropped'),
  },
  table => [index('idx_image_card').on(table.cardId)],
)

// Run log for catalog imports, so a sync's outcome (and card count) is
// observable without tailing logs.
export const catalogSync = sqliteTable('catalog_sync', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  status: text('status').notNull().$type<'running' | 'success' | 'error'>(),
  cardCount: integer('card_count'),
  error: text('error'),
})
