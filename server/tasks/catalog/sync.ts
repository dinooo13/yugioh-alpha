import { useDb } from '../../db'
import { syncCatalog } from '../../utils/catalog-sync'

export default defineTask({
  meta: {
    name: 'catalog:sync',
    description: 'Fetches the full YGOPRODeck card database and upserts it into the local catalog.',
  },
  async run() {
    const result = await syncCatalog(useDb())
    return { result }
  },
})
