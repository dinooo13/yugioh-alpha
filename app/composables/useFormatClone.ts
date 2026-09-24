import { RULE_FORMAT_NAME_MAX_LENGTH } from '~~/shared/rule-formats'
import type { RuleSet } from '~~/shared/rule-formats'
import { copyName } from '~/utils/copy-name'

interface CloneSource {
  id: string
  name: string
  description: string | null
  isBuiltin: boolean
  /** The rules, when already loaded (format detail page). */
  rules?: RuleSet
}

/**
 * Clones a format (`POST /api/formats/:id/clone`) and names the copy in the
 * interface language ("… (Kopie)" / "… (copy)"). A built-in format's copy
 * also takes over its translated description and rule labels, so the copy
 * reads the same as the original did (ADR 0014) — after that it is the
 * user's own content.
 */
export function useFormatClone() {
  const { t, te } = useI18n()
  const { formatName, formatDescription, localizedRules } = useFormatLabel()

  return async (format: CloneSource) => {
    const body: { name: string, description?: string | null, rules?: RuleSet } = {
      name: copyName(name => t('formats.copyName', { name }), formatName(format), RULE_FORMAT_NAME_MAX_LENGTH),
    }

    if (format.isBuiltin) {
      body.description = formatDescription(format)
      // Only a built-in with a translated rule label needs its rules sent.
      if (te(`formats.builtin.${format.id}.cutoffLabel`)) {
        const rules = format.rules ?? (await $fetch<{ rules?: RuleSet }>(`/api/formats/${format.id}`)).rules
        if (rules?.rules) {
          body.rules = localizedRules(format, rules)
        }
      }
    }

    return $fetch<{ id: string, name: string }>(`/api/formats/${format.id}/clone`, { method: 'POST', body })
  }
}
