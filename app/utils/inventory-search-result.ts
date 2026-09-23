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

export function breakdownLabel(entry: InventoryCollectionBreakdown): string {
  return entry.collectionId ? (entry.collectionName ?? 'Unbenannte Sammlung') : '(keine Sammlung)'
}

export function breakdownKey(entry: InventoryCollectionBreakdown): string {
  return entry.collectionId ?? '__none__'
}

export function cardSubtitle(item: Pick<InventorySearchResultItem, 'type' | 'attribute' | 'race'>): string {
  return [item.type, item.attribute, item.race].filter(Boolean).join(' · ')
}
