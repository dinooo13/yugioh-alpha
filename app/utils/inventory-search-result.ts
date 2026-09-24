// Shape of one aggregated row from `GET /api/inventory/search`, shared by the
// "Übersicht" tile and its preview modal.
export interface InventoryCollectionBreakdown {
  collectionId: string | null
  collectionName: string | null
  quantity: number
}

export interface InventorySearchResultItem {
  catalogCardId: number
  name: string
  /** Official German name (ADR 0015); null when there is none. */
  nameDe?: string | null
  type: string
  attribute: string | null
  race: string | null
  level: number | null
  atk: number | null
  def: number | null
  imageSmall: string | null
  imageLarge?: string | null
  totalQuantity: number
  collectionBreakdown?: InventoryCollectionBreakdown[]
}

/** Collection name for a breakdown row; `t` translates the two fallbacks (ADR 0014). */
export function breakdownLabel(entry: InventoryCollectionBreakdown, t: (key: string) => string): string {
  if (!entry.collectionId) {
    return t('inventory.breakdown.noCollection')
  }
  return entry.collectionName ?? t('inventory.breakdown.unnamedCollection')
}

export function breakdownKey(entry: InventoryCollectionBreakdown): string {
  return entry.collectionId ?? '__none__'
}

export function cardSubtitle(item: Pick<InventorySearchResultItem, 'type' | 'attribute' | 'race'>): string {
  return [item.type, item.attribute, item.race].filter(Boolean).join(' · ')
}
