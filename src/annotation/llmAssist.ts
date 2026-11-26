import type { AnnotationTask, Id, LlmSuggestion } from '../types'
import { count } from './annotationState'

/** legal-ml-core's default for `LLM_MAX_SYNC_TASKS`, for servers whose status does not report `max_sync_tasks`. */
export const SUGGEST_BATCH_SIZE = 10

/** Pending items as the queue serves them: scored items best first, the rest in row order. */
export function queueOrder(tasks: AnnotationTask[]): AnnotationTask[] {
  return [...tasks].sort((a, b) => {
    const sa = a.score ?? null
    const sb = b.score ?? null
    if (sa !== sb) {
      if (sa === null) return 1
      if (sb === null) return -1
      return sb - sa
    }
    return a.item_index - b.item_index
  })
}

/** Newest first: the latest prompt version, then the latest made. A list in
 * this order finds an item's current suggestion first. */
export function newestFirst(suggestions: LlmSuggestion[]): LlmSuggestion[] {
  return [...suggestions].sort(
    (a, b) => b.prompt_version - a.prompt_version || (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0),
  )
}

/** The item's suggestion still waiting for a person from the prompt version
 * and model in use (when known), or null when it needs asking for. */
export function waitingSuggestion(
  suggestions: LlmSuggestion[],
  taskId: Id,
  inUse: { promptVersion: number | null; model: string | null },
): LlmSuggestion | null {
  return (
    newestFirst(suggestions).find(
      (s) =>
        s.task_id === taskId &&
        s.status === 'pending' &&
        (inUse.promptVersion === null || s.prompt_version >= inUse.promptVersion) &&
        (!inUse.model || s.model === inUse.model),
    ) ?? null
  )
}

/** What one round of suggesting produced, in counts. */
export function batchSummary({ created, skipped, invalid }: { created: number; skipped: number; invalid: number }): string {
  if (!created && !skipped && !invalid) return 'There were no pending items to suggest labels for.'
  const parts = [`${count(created, 'suggestion')} ready.`]
  if (skipped) parts.push(`${count(skipped, 'item already had one', 'items already had one')}.`)
  if (invalid) {
    parts.push(
      `${count(invalid, 'answer was', 'answers were')} discarded because ${invalid === 1 ? 'it' : 'they'} did not give one of your labels.`,
    )
  }
  return parts.join(' ')
}

export function tokens(value: number): string {
  return value.toLocaleString('en-GB')
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}
