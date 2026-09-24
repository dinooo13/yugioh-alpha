import { isBuiltinFormatId } from '~~/shared/rule-formats'
import type { Rule } from '~~/shared/rule-formats'

interface FormatRef {
  id?: string | null
  /** When known; a user format's id (a UUID) never matches a built-in id anyway. */
  isBuiltin?: boolean
}

/**
 * Names and descriptions of rule formats in the interface language
 * (ADR 0014). The built-in formats (`BUILTIN_FORMAT_IDS`) are stored in
 * canonical English and shown from `formats.builtin.<id>.*`; a user's own
 * format is user content and shown as it is.
 */
export function useFormatLabel() {
  const { t, te, locale } = useI18n()

  function builtinKey(format: FormatRef): string | null {
    return format.isBuiltin !== false && isBuiltinFormatId(format.id) ? `formats.builtin.${format.id}` : null
  }

  function translated(format: FormatRef, field: string): string | null {
    const key = builtinKey(format)
    return key && te(`${key}.${field}`) ? t(`${key}.${field}`) : null
  }

  function formatName(format: FormatRef & { name: string }): string {
    return translated(format, 'name') ?? format.name
  }

  function formatDescription(format: FormatRef & { description: string | null }): string | null {
    return translated(format, 'description') ?? format.description
  }

  /** A filter rule's label; a built-in format's cutoff label is translated. */
  function ruleLabel(format: FormatRef, label: string): string {
    return translated(format, 'cutoffLabel') ?? label
  }

  /** The rules with translated labels (built-ins), for display and for a translated clone. */
  function localizedRules<T extends { rules: Rule[] }>(format: FormatRef, ruleSet: T): T {
    if (!builtinKey(format)) {
      return ruleSet
    }
    return {
      ...ruleSet,
      rules: ruleSet.rules.map(rule => (rule.kind === 'filter' && rule.label ? { ...rule, label: ruleLabel(format, rule.label) } : rule)),
    }
  }

  /**
   * Built-ins first, sorted by their translated name, then the user's own
   * formats in the order given (the API sorts those by name).
   */
  function sortFormats<T extends FormatRef & { name: string, isBuiltin: boolean }>(formats: T[]): T[] {
    const builtins = formats.filter(format => format.isBuiltin)
      .sort((a, b) => formatName(a).localeCompare(formatName(b), locale.value))
    return [...builtins, ...formats.filter(format => !format.isBuiltin)]
  }

  return { formatName, formatDescription, ruleLabel, localizedRules, sortFormats }
}
