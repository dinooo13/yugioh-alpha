// Wire contract for Phase 6 (sharing and social features), shared by the
// server and the UI. Dependency-free (same discipline as
// shared/assistant-chat.ts): no Drizzle, no h3, no Vue. See
// docs/adr/0007-sharing-and-profile-model.md for the design rationale.

import type { DeckCover } from './deck-cover'
import type { DeckSection } from './deck-sections'
import type { AppLocale } from './locale'
import type { DeckValidation } from './rule-formats'

export const VISIBILITIES = ['private', 'link', 'public'] as const
export type Visibility = typeof VISIBILITIES[number]

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: 'Privat',
  link: 'Nur über Link',
  public: 'Öffentlich',
}
export const VISIBILITY_DESCRIPTIONS: Record<Visibility, string> = {
  private: 'Nur du kannst das sehen.',
  link: 'Jede Person mit dem Link kann es ansehen.',
  public: 'Für alle sichtbar und auf deinem Profil gelistet.',
}

export const SHARE_RESOURCE_TYPES = ['deck', 'collection', 'inventory'] as const
export type ShareResourceType = typeof SHARE_RESOURCE_TYPES[number]

export const WISHLIST_VISIBILITIES = ['private', 'public'] as const
export type WishlistVisibility = typeof WISHLIST_VISIBILITIES[number]

export interface UserSearchItem { userId: string, handle: string, displayName: string }
export interface ShareGrantItem { userId: string, handle: string, displayName: string, createdAt: string }

export interface ShareState {
  resourceType: ShareResourceType
  resourceId: string
  visibility: Visibility
  /** NULL while private. Owner-only: never returned by a /api/profiles/** endpoint. */
  shareToken: string | null
  grants: ShareGrantItem[]
}

export interface ShareUpdateBody { visibility?: Visibility, regenerateToken?: boolean }

export interface OwnProfile {
  userId: string
  handle: string
  displayName: string
  bio: string | null
  inventoryVisibility: Visibility
  wishlistVisibility: WishlistVisibility
  /** Chosen interface language (ADR 0014); null = not chosen. */
  locale: AppLocale | null
  createdAt: string
  updatedAt: string
}

export interface PublicProfileSummary { handle: string, displayName: string, bio: string | null }

export interface SharedDeckSummary {
  id: string
  name: string
  description: string | null
  mainCount: number
  extraCount: number
  sideCount: number
  cardCount: number
  formatName: string | null
  legal: boolean | null
  /** Null for non-owners: an owner-side setting the grant does not entitle them to see. */
  visibility: Visibility | null
  updatedAt: string
  /** Cover card for the deck tile (#29); `null` for a deck without Main/Extra cards. */
  cover: DeckCover | null
}

export interface SharedCollectionSummary {
  id: string
  name: string
  description: string | null
  cardCount: number
  /** Null for non-owners: an owner-side setting the grant does not entitle them to see. */
  visibility: Visibility | null
}

export interface PublicProfileResponse {
  profile: PublicProfileSummary
  viewer: { isAuthenticated: boolean, isOwner: boolean }
  decks: SharedDeckSummary[]
  collections: SharedCollectionSummary[]
  inventory: { visible: boolean, cardCount: number }
  wishlist: { visible: boolean, itemCount: number }
}

/** Deck card row WITHOUT owned / usedInDeck / shortfall. */
export interface SharedDeckCardRow {
  catalogCardId: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  /** Full-size scan for click-to-enlarge. */
  imageLarge: string | null
  section: DeckSection
  quantity: number
}

export interface SharedDeckView {
  owner: PublicProfileSummary
  deck: { id: string, name: string, description: string | null, updatedAt: string }
  sections: Record<DeckSection, SharedDeckCardRow[]>
  counts: { main: number, extra: number, side: number, total: number }
  limits: { mainMin: number, mainMax: number, extraMax: number, sideMax: number, maxCopies: number }
  warnings: Array<{ code: string, message: string, cardId?: number }>
  format: { id: string, name: string, isBuiltin: boolean } | null
  validation: DeckValidation | null
  /** True when the *viewer* is the owner (UI shows a "Bearbeiten" link). */
  isOwner: boolean
}

export interface SharedCardListItem {
  catalogCardId: number
  name: string
  type: string
  frameType: string | null
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  /** Full-size scan for click-to-enlarge. */
  imageLarge: string | null
  /** Copies the owner holds in this source. */
  quantity: number
}

export interface SharedCardListResponse {
  owner: PublicProfileSummary
  source: { kind: 'inventory' | 'collection', id: string | null, name: string }
  items: SharedCardListItem[]
  total: number
  page: number
  pageSize: number
  isOwner: boolean
}

export interface WishlistItemView {
  id: string
  catalogCardId: number
  name: string
  type: string
  imageSmall: string | null
  quantity: number
  note: string | null
  /** Owner-only: copies already in the inventory. Absent in the public view. */
  owned?: number
  createdAt: string
  updatedAt: string
}

export interface WishlistResponse { items: WishlistItemView[], total: number, page: number, pageSize: number }
export interface SharedWishlistResponse extends WishlistResponse { owner: PublicProfileSummary }
