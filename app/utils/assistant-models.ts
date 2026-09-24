// Display names of the models the assistant can run on (the model picker in
// the composer, and the note under an answer). The ids come from the
// server's configuration (`NUXT_ASSISTANT_MODELS`) and go to the provider as
// they are; an id without a name here is shown as it is.

const MODEL_LABELS: Record<string, string> = {
  'mimo-v2.6-pro': 'MiMo v2.6 Pro',
  'mimo-v2.6-flash': 'MiMo v2.6 Flash',
  'glm-5.3-flash': 'GLM 5.3 Flash',
  'deepseek-v4.1-flash': 'DeepSeek v4.1 Flash',
  'deepseek-v4-flash-vision-exp': 'DeepSeek v4 Flash Vision (exp.)',
}

export function assistantModelLabel(id: string): string {
  return MODEL_LABELS[id] ?? id
}

/** The cookie that remembers the picked model on this device. */
export const ASSISTANT_MODEL_COOKIE = 'ygo-assistant-model'
