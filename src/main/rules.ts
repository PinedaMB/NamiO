import type { Rule, RuleDraft } from '@shared/ipc'
import {
  allCachedMessages,
  archiveMailboxPath,
  bumpRuleHits,
  deleteRuleRow,
  enqueueOutbox,
  insertRule,
  listRules,
  messagesByUids,
  updateRule,
  type CachedMessage,
  type RuleRow
} from './db'

/**
 * Reglas locales: se evalúan sobre lo que llega al buzón (y a pedido sobre la
 * caché). La primera regla habilitada que coincide gana, así un mensaje no
 * recibe dos acciones contradictorias. Las acciones van a la cola de salida:
 * se aplican en el servidor con reintentos, igual que archivar a mano.
 */

/** Sin mayúsculas ni acentos: "Boletín" tiene que encontrar "boletin". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function textOf(field: RuleRow['field'], message: CachedMessage): string {
  switch (field) {
    case 'from':
      return `${message.fromName} ${message.fromAddr}`
    case 'to':
      return message.to
    case 'subject':
      return message.subject
    default:
      return `${message.subject} ${message.fromName} ${message.fromAddr} ${message.to}`
  }
}

function matches(rule: RuleRow, message: CachedMessage): boolean {
  const needle = normalize(rule.value)
  if (needle === '') return false

  const haystack = normalize(textOf(rule.field, message))
  switch (rule.op) {
    case 'equals':
      return haystack === needle || normalize(message.fromAddr) === needle
    case 'starts':
      return haystack.startsWith(needle)
    default:
      return haystack.includes(needle)
  }
}

interface QueuedAction {
  kind: 'archive' | 'delete' | 'move' | 'seen'
  payload?: unknown
  /** Buzón al que va a parar el mensaje (para no encolar un no-op). */
  destination: string | null
}

function actionOf(rule: RuleRow): QueuedAction | null {
  switch (rule.action) {
    case 'archive':
      return { kind: 'archive', destination: archiveMailboxPath() }
    case 'delete':
      return { kind: 'delete', destination: null }
    case 'move':
      return rule.target
        ? { kind: 'move', payload: { target: rule.target }, destination: rule.target }
        : null
    case 'read':
      return { kind: 'seen', destination: null }
    default:
      return null
  }
}

/** Aplica las reglas a un conjunto de mensajes y devuelve cuántos tocó. */
export function applyRulesTo(messages: readonly CachedMessage[]): number {
  const rules = listRules().filter((rule) => rule.enabled === 1)
  if (rules.length === 0 || messages.length === 0) return 0

  let matched = 0
  for (const message of messages) {
    const rule = rules.find((candidate) => matches(candidate, message))
    if (!rule) continue

    const action = actionOf(rule)
    if (!action) continue
    // Mover a la carpeta donde ya está no es una acción, es ruido.
    if (action.destination && action.destination === message.mailbox) continue

    enqueueOutbox({
      kind: action.kind,
      mailbox: message.mailbox,
      uid: message.uid,
      payload: action.payload
    })
    bumpRuleHits(rule.id)
    matched += 1
  }
  return matched
}

/** Mensajes recién llegados al buzón (los que el motor acaba de descubrir). */
export function applyRulesToNew(mailbox: string, uids: readonly number[]): number {
  if (uids.length === 0) return 0
  return applyRulesTo(messagesByUids(mailbox, uids))
}

/** Repaso manual sobre todo lo cacheado (botón "aplicar a los existentes"). */
export function applyRulesToCache(): number {
  return applyRulesTo(allCachedMessages())
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    field: row.field as Rule['field'],
    op: row.op as Rule['op'],
    value: row.value,
    action: row.action as Rule['action'],
    target: row.target,
    hits: row.hits,
    createdAt: row.createdAt
  }
}

export function readRules(): Rule[] {
  return listRules().map(toRule)
}

export function saveRule(input: RuleDraft & { id?: number }): Rule[] {
  const row = {
    name: input.name.trim() === '' ? input.value.trim() : input.name.trim(),
    enabled: input.enabled,
    field: input.field,
    op: input.op,
    value: input.value.trim(),
    action: input.action,
    target: input.action === 'move' ? (input.target ?? null) : null
  }

  if (input.id === undefined) insertRule(row)
  else updateRule(input.id, row)

  return readRules()
}

export function removeRule(id: number): Rule[] {
  deleteRuleRow(id)
  return readRules()
}
