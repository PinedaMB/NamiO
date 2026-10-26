import type { TranslationKey } from '../i18n'

/** Acciones remapeables. `escape` queda fuera a propósito: siempre cierra. */
export type ShortcutAction =
  | 'next'
  | 'prev'
  | 'archive'
  | 'star'
  | 'snooze'
  | 'reply'
  | 'compose'
  | 'palette'
  | 'settings'

export type ShortcutGroup = 'navigation' | 'triage' | 'composition' | 'app'

export interface ShortcutDef {
  id: ShortcutAction
  group: ShortcutGroup
  icon: string
  labelKey: TranslationKey
  hintKey: TranslationKey
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'next', group: 'navigation', icon: 'south', labelKey: 'shortcut.next', hintKey: 'shortcut.nextHint' },
  { id: 'prev', group: 'navigation', icon: 'north', labelKey: 'shortcut.prev', hintKey: 'shortcut.prevHint' },
  { id: 'archive', group: 'triage', icon: 'done_all', labelKey: 'shortcut.archive', hintKey: 'shortcut.archiveHint' },
  { id: 'star', group: 'triage', icon: 'star', labelKey: 'shortcut.star', hintKey: 'shortcut.starHint' },
  { id: 'snooze', group: 'triage', icon: 'schedule', labelKey: 'shortcut.snooze', hintKey: 'shortcut.snoozeHint' },
  { id: 'reply', group: 'composition', icon: 'reply', labelKey: 'shortcut.reply', hintKey: 'shortcut.replyHint' },
  { id: 'compose', group: 'composition', icon: 'edit_square', labelKey: 'shortcut.compose', hintKey: 'shortcut.composeHint' },
  { id: 'palette', group: 'app', icon: 'terminal', labelKey: 'shortcut.palette', hintKey: 'shortcut.paletteHint' },
  { id: 'settings', group: 'app', icon: 'settings', labelKey: 'shortcut.settings', hintKey: 'shortcut.settingsHint' }
]

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroup; labelKey: TranslationKey }[] = [
  { id: 'navigation', labelKey: 'settings.group.navigation' },
  { id: 'triage', labelKey: 'settings.group.triage' },
  { id: 'composition', labelKey: 'settings.group.composition' },
  { id: 'app', labelKey: 'settings.group.app' }
]

export type Bindings = Record<ShortcutAction, string>

export const DEFAULT_BINDINGS: Bindings = {
  next: 'j',
  prev: 'k',
  archive: 'e',
  star: 's',
  snooze: 'h',
  reply: 'r',
  compose: 'c',
  palette: 'mod+k',
  settings: 'mod+,'
}

const ACTIONS = new Set<string>(SHORTCUTS.map((shortcut) => shortcut.id))

/** Normaliza un evento a `mod+shift+k`, `j`, `,`… Devuelve null si es un modificador solo. */
export function comboFromEvent(event: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')

  const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
  parts.push(key)
  return parts.join('+')
}

/** Texto para mostrar en un `kbd`. */
export function formatCombo(combo: string): string {
  const parts = combo.split('+')
  const key = parts.pop() ?? ''
  const modifiers = parts.map((part) => (part === 'mod' ? '⌘' : part === 'alt' ? '⌥' : part === 'shift' ? '⇧' : part))
  const label = key === 'space' ? 'Space' : key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
  return `${modifiers.join('')}${label}`
}

/** Solo acepta acciones conocidas y combinaciones no vacías: settings.json puede estar editado a mano. */
export function normalizeBindings(raw: unknown): Partial<Bindings> {
  if (typeof raw !== 'object' || raw === null) return {}
  const result: Partial<Bindings> = {}
  for (const [action, combo] of Object.entries(raw)) {
    if (!ACTIONS.has(action)) continue
    if (typeof combo !== 'string' || combo.trim() === '') continue
    result[action as ShortcutAction] = combo.trim().toLowerCase()
  }
  return result
}

export function actionForCombo(bindings: Bindings, combo: string): ShortcutAction | undefined {
  return (Object.keys(bindings) as ShortcutAction[]).find((action) => bindings[action] === combo)
}
