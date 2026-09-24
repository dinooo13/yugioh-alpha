import { useDb } from '../../db'
import { refreshCatalog } from '../../utils/catalog-refresh'

export default defineTask({
  meta: {
    name: 'catalog:sync',
    description: 'Fetches the full YGOPRODeck card database into the local catalog, then the German card data (ADR 0015).',
  },
  async run() {
    const result = await refreshCatalog(useDb())
    return { result }
  },
})
