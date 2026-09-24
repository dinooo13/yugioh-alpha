import { useDb } from '../../db'
import { syncCardTranslations } from '../../utils/card-translations-sync'

export default defineTask({
  meta: {
    name: 'catalog:sync-translations',
    description: 'Imports German card names and texts from the ygoresources card-history repo; skipped when the repo is unchanged (ADR 0015).',
  },
  async run() {
    const result = await syncCardTranslations(useDb())
    return { result }
  },
})
