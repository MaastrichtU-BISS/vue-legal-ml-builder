import type { AnnotationTask, Id, LlmEstimate, LlmJob, LlmSuggestion } from '../types'
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

// ---------------------------------------------------------------------------
// Free models (BAIGLE #225): the provider, not this platform, limits them by
// requests a minute and a day.
// ---------------------------------------------------------------------------

/** Said once a free model is chosen. */
export const FREE_MODEL_HINT =
  "Free models on OpenRouter allow about 20 requests a minute and 50 a day (1,000 a day once you've bought $10 of credit)."

/** Free at the provider: flagged by the server, or an OpenRouter `:free` id. */
export function isFreeModel(model: { id: string; free?: boolean }): boolean {
  return model.free === true || model.id.endsWith(':free')
}

/** The warning before a batch bigger than the free model's daily allowance.
 * Empty when it fits. It never stops the job from starting. */
export function providerLimitWarning(estimate: Pick<LlmEstimate, 'tasks' | 'over_provider_limit' | 'provider_daily_limit'>): string {
  if (!estimate.over_provider_limit) return ''
  const allows = typeof estimate.provider_daily_limit === 'number'
    ? `about ${tokens(estimate.provider_daily_limit)} requests a day`
    : 'only so many requests a day'
  return `This free model allows ${allows} on OpenRouter, and this batch has ${count(estimate.tasks, 'item')}. The job will stop when the allowance runs out; what's done is kept.`
}

/** A running job waiting out the provider's per-minute limit; empty otherwise. */
export function providerWaitLine(job: Pick<LlmJob, 'status' | 'waiting_seconds'> | null): string {
  const wait = job?.status === 'running' ? job.waiting_seconds : null
  return typeof wait === 'number' && wait > 0 ? `Waiting ${Math.ceil(wait)}s for the provider's per-minute limit…` : ''
}
