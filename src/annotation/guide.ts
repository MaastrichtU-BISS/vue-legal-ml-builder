// The guided "Label with AI help" mode: its steps, which one a Dataset is on,
// and the per-Dataset choice to hide it. The step is always worked out from
// what the server reports, never stored.

import type { Id, LlmAgreement } from '../types'

export type GuideStepKey = 'labels' | 'connect' | 'show' | 'try' | 'rest' | 'ready'

export interface GuideStep {
  key: GuideStepKey
  /** The rail's name for the step. */
  short: string
  /** The step's heading in the panel. */
  title: string
  /** Roughly how long the step takes; none for the last. */
  time: string | null
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  { key: 'labels', short: 'Your labels', title: 'Name your labels', time: 'About 2 minutes' },
  { key: 'connect', short: 'Connect AI', title: 'Connect an AI', time: 'About 2 minutes' },
  { key: 'show', short: 'Show it how', title: 'Show the AI how you label', time: 'About 5 minutes' },
  { key: 'try', short: 'Try it', title: 'Try the AI on a few items', time: 'About 10 minutes' },
  { key: 'rest', short: 'Do the rest', title: 'Let the AI label the rest', time: 'A few minutes' },
  { key: 'ready', short: 'Ready to train', title: 'Your dataset is ready to train', time: null },
]

/** Task types with one label per item: the only ones the guide (and LLM help) covers. */
export const SINGLE_LABEL_TASK_TYPES = ['classification', 'document_classification', 'judgment_prediction'] as const

export function isSingleLabelTask(taskType: string): boolean {
  return (SINGLE_LABEL_TASK_TYPES as readonly string[]).includes(taskType)
}

/** Examples a person labels before the AI is tried: per label, and in total. */
export const SHOW_PER_LABEL = 3
export const SHOW_TOTAL = 10
/** Confirmed examples each label needs before the Dataset is ready to train. */
export const READY_PER_LABEL = 2

export interface GuideProgress {
  /** The Dataset's named labels. */
  labels: string[]
  /** The account can use an LLM (`useLlmAssist`'s `hasAccess`). */
  hasAccess: boolean
  /** The Project allowed sending text to the current destination. */
  acknowledged: boolean
  /** Confirmed labels per label name; null when the server cannot say. */
  confirmedPerLabel: Record<string, number> | null
  /** Confirmed labels in total. */
  confirmedTotal: number
  /** Items still waiting for a label, held-back items left out; null when unknown. */
  pending: number | null
  /** The agreement check for the current model and prompt, as the server reports it. */
  agreement: LlmAgreement | null
}

/** The agreement check passed, by the server's own sample size and threshold. */
export function agreementPassed(agreement: LlmAgreement | null): boolean {
  if (!agreement || agreement.rate === null) return false
  return agreement.checked >= agreement.min_sample && agreement.rate >= agreement.threshold
}

/** The check as it stands for the prompt version and model in use. The server
 * reports the check for its latest suggestion, so straight after a new prompt
 * version (or model) it still describes the old one until the first new
 * suggestion: that check starts from zero, as the server will count it. */
export function currentAgreement(
  agreement: LlmAgreement | null,
  inUse: { promptVersion: number | null; model: string | null },
): LlmAgreement | null {
  if (!agreement) return null
  const newerPrompt =
    inUse.promptVersion !== null && agreement.prompt_version !== null && inUse.promptVersion > agreement.prompt_version
  const otherModel = !!inUse.model && !!agreement.model && inUse.model !== agreement.model
  if (!newerPrompt && !otherModel) return agreement
  return {
    ...agreement,
    model: inUse.model ?? agreement.model,
    prompt_version: inUse.promptVersion ?? agreement.prompt_version,
    checked: 0,
    agreed: 0,
    rate: null,
    unlocked: false,
  }
}

/** What Try it's suggestion box shows for the item on screen: a held-out
 * item, the request on its way, the suggestion, a failed request, an answer
 * that wasn't one of the labels (reported as skipped), no suggestion to show,
 * or no item. */
export type TryView = 'holdout' | 'asking' | 'ready' | 'failed' | 'invalid' | 'answered' | 'idle'

/** An item the AI and the student labelled differently, for the improving state. */
export interface Disagreement {
  id: Id
  text: string
  yours: string
  ai: string
}

/** Try it's improving state: the server's full sample is checked and the AI
 * agreed less often than its threshold. */
export function agreementLow(agreement: LlmAgreement | null): boolean {
  if (!agreement || agreement.rate === null) return false
  return agreement.checked >= agreement.min_sample && agreement.rate < agreement.threshold
}

/** Try it's running count, in the server's own sample size and threshold. */
export function agreementLine(agreement: LlmAgreement | null): string {
  const checked = agreement?.checked ?? 0
  const agreed = agreement?.agreed ?? 0
  const minSample = agreement?.min_sample ?? 0
  const left = Math.max(minSample - checked, 0)
  if (left > 0) {
    const more = `${left} more to check before it can label the rest.`
    return checked ? `The AI agreed with you on ${agreed} of ${checked}. ${more}` : `${more[0].toUpperCase()}${more.slice(1)}`
  }
  const threshold = Math.round((agreement?.threshold ?? 0) * 100)
  return `The AI agreed with you on ${agreed} of ${checked}. It needs to agree at least ${threshold}% of the time before it can label the rest.`
}

/** One label's count in Show it how, and the count it can still reach. */
export interface ShowLabelTarget {
  label: string
  count: number
  /** The most it can reach: SHOW_PER_LABEL, or fewer when too few items are left. */
  target: number
  /** Too few items are left to reach SHOW_PER_LABEL: what it has is enough. */
  capped: boolean
}

export interface ShowTargets {
  /** Per label; empty when the server cannot count per label. */
  labels: ShowLabelTarget[]
  total: number
  /** The most the total can reach: SHOW_TOTAL, or fewer when too few items are left. */
  totalTarget: number
}

/** What Show it how asks for. With the items left known, a label (or the
 * total) that cannot reach its target any more has enough, so it never holds
 * the step; with the queue still open we cannot tell, so it does. */
export function showTargets(p: Pick<GuideProgress, 'labels' | 'confirmedPerLabel' | 'confirmedTotal' | 'pending'>): ShowTargets {
  const reach = (count: number, wanted: number) => (p.pending === null ? wanted : Math.min(wanted, count + p.pending))
  const labels = p.confirmedPerLabel === null
    ? []
    : p.labels.map((label) => {
        const count = p.confirmedPerLabel![label] ?? 0
        const target = reach(count, SHOW_PER_LABEL)
        return { label, count, target, capped: target < SHOW_PER_LABEL }
      })
  return { labels, total: p.confirmedTotal, totalTarget: reach(p.confirmedTotal, SHOW_TOTAL) }
}

function showMet(p: GuideProgress): boolean {
  const targets = showTargets(p)
  return (
    targets.labels.every((l) => l.capped || l.count >= SHOW_PER_LABEL) &&
    (targets.totalTarget < SHOW_TOTAL || targets.total >= SHOW_TOTAL)
  )
}

/** The step a Dataset is on. A step already done is skipped. "Improving" is a
 * state of `try` (agreement below the threshold at a full sample), not a step. */
export function guideStep(p: GuideProgress): GuideStepKey {
  if (p.labels.length < 2) return 'labels'
  const left = p.pending === null ? true : p.pending > 0
  // Nothing left to label: the AI has nothing to do, whatever its state.
  if (!left) return 'ready'
  if (!p.hasAccess || !p.acknowledged) return 'connect'
  if (!showMet(p)) return 'show'
  if (!agreementPassed(p.agreement)) return 'try'
  // Pending items remain and the check passed: the AI labels the rest.
  return 'rest'
}

/** Whether each step's own condition is met, so a step passed only because
 * nothing is left is not called done. "Do the rest" counts as done when the
 * agreement check passed and nothing is left; "Ready to train" when nothing is
 * left. */
export function stepsMet(p: GuideProgress): Record<GuideStepKey, boolean> {
  const passed = agreementPassed(p.agreement)
  return {
    labels: p.labels.length >= 2,
    connect: p.hasAccess && p.acknowledged,
    // Reached in full: a label that ran out of items moved the step on, but is skipped, not done.
    show: !(p.confirmedPerLabel !== null && p.labels.some((label) => (p.confirmedPerLabel![label] ?? 0) < SHOW_PER_LABEL)) && p.confirmedTotal >= SHOW_TOTAL,
    try: passed,
    rest: passed && p.pending === 0,
    ready: p.pending === 0,
  }
}

/** Labels with fewer than READY_PER_LABEL confirmed examples: what the Ready
 * step warns about. Empty when the server cannot count per label. */
export function labelsShortOfReady(p: Pick<GuideProgress, 'labels' | 'confirmedPerLabel'>): string[] {
  if (p.confirmedPerLabel === null) return []
  return p.labels.filter((label) => (p.confirmedPerLabel![label] ?? 0) < READY_PER_LABEL)
}

export function stepIndex(key: GuideStepKey): number {
  return GUIDE_STEPS.findIndex((step) => step.key === key)
}

// ---------------------------------------------------------------------------
// Remembered per Dataset in browser storage. Every access is guarded: with no
// storage the guide simply shows.
// ---------------------------------------------------------------------------

export type GuidePreference = 'hidden' | 'shown' | null | 'unavailable'

export function guideStorageKey(datasetId: Id): string {
  return `vmlb-guide-hidden:${datasetId}`
}

/** `null` when nothing is stored yet; `unavailable` when storage can't be read. */
export function readGuidePreference(datasetId: Id): GuidePreference {
  try {
    const value = window.localStorage.getItem(guideStorageKey(datasetId))
    if (value === '1') return 'hidden'
    if (value === '0') return 'shown'
    return null
  } catch {
    return 'unavailable'
  }
}

export function writeGuidePreference(datasetId: Id, hidden: boolean): void {
  try {
    window.localStorage.setItem(guideStorageKey(datasetId), hidden ? '1' : '0')
  } catch {
    // No storage: the choice lasts for this visit only.
  }
}

/** Label descriptions saved with the labels but not yet in a prompt version,
 * because the prompt could not be saved without LLM access. Kept until the
 * prompt next loads. */
function descriptionsKey(datasetId: Id): string {
  return `vmlb-guide-descriptions:${datasetId}`
}

export function readPendingDescriptions(datasetId: Id): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(descriptionsKey(datasetId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null
  } catch {
    return null
  }
}

export function writePendingDescriptions(datasetId: Id, descriptions: Record<string, string> | null): void {
  try {
    if (descriptions) window.localStorage.setItem(descriptionsKey(datasetId), JSON.stringify(descriptions))
    else window.localStorage.removeItem(descriptionsKey(datasetId))
  } catch {
    // No storage: the descriptions are kept in memory for this visit.
  }
}

/** The waiting sentences to put in the prompt: those for labels whose
 * definition is still empty, or every one when they were typed this visit
 * (`fresh`), so newer than the prompt. Empty when nothing would change. */
export function definitionsToFill(
  defined: Record<string, string>,
  waiting: Record<string, string>,
  fresh: boolean,
): Record<string, string> {
  const fill = Object.entries(waiting).filter(([label, text]) => text.trim() && (fresh || !defined[label]?.trim()))
  return Object.fromEntries(fill.filter(([label, text]) => defined[label] !== text))
}

// ---------------------------------------------------------------------------
// Step 1: the label list as typed.
// ---------------------------------------------------------------------------

export interface LabelDraft {
  name: string
  description: string
  /** Already used on an item: shown read-only. */
  locked: boolean
}

export interface LabelErrors {
  /** About the list as a whole. */
  list: string | null
  /** Per row, by index. */
  names: Record<number, string>
  descriptions: Record<number, string>
}

export function validateLabels(rows: LabelDraft[]): LabelErrors {
  const errors: LabelErrors = { list: null, names: {}, descriptions: {} }
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    const name = row.name.trim()
    if (!name) errors.names[i] = "Label names can't be empty"
    else if (seen.has(name.toLowerCase())) errors.names[i] = 'Two labels have the same name'
    seen.add(name.toLowerCase())
    if (!row.description.trim()) errors.descriptions[i] = 'Write one sentence saying when to use this label'
  })
  if (rows.length < 2) errors.list = 'Use at least two labels'
  return errors
}

export function hasLabelErrors(errors: LabelErrors): boolean {
  return !!errors.list || Object.keys(errors.names).length > 0 || Object.keys(errors.descriptions).length > 0
}
