import { createError, readBody } from 'h3'
import { useDb } from '../../db'
import { runDeckAssistant, validateDeckAssistantRequest } from '../../utils/deck-assistant'
import { useDeckAssistantModel } from '../../utils/deck-assistant-model'
import { requireUser } from '../../utils/session'

// A deck-assistant request does several DB reads plus one model call; a
// double-click or duplicate submit must not run two of them for the same
// user at once. Module-level and in-memory only — fine for a single Nitro
// process, and nothing here needs to survive a restart.
const usersInFlight = new Set<string>()

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const request = validateDeckAssistantRequest(await readBody(event))

  const model = useDeckAssistantModel()
  if (!model) {
    throw createError({ statusCode: 503, statusMessage: 'KI-Assistent ist nicht konfiguriert.' })
  }

  if (usersInFlight.has(user.id)) {
    throw createError({ statusCode: 429, statusMessage: 'Es läuft bereits eine Anfrage.' })
  }

  usersInFlight.add(user.id)
  try {
    return await runDeckAssistant(useDb(), user.id, request, model)
  }
  finally {
    usersInFlight.delete(user.id)
  }
})
