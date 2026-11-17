// What the summarization views show, decided from what the server and store report.

import type { GenerationSource, SummarizationError, SummarizationJobStatus, SummarizationModels } from '../types'

export interface SummaryModelChoice {
  id: string
  label: string
  description: string
  kind: 'extractive' | 'abstractive'
  /** Abstractive models cannot be chosen while the server has none loaded. */
  disabled: boolean
}

/** The server's models as picker entries, extractive first. */
export function summaryModelChoices(models: SummarizationModels | null): SummaryModelChoice[] {
  if (!models) return []
  return [
    ...models.extractive.map((m) => ({ ...m, kind: 'extractive' as const, disabled: false })),
    ...models.abstractive.map((m) => ({ ...m, kind: 'abstractive' as const, disabled: !models.abstractive_available })),
  ]
}

/** The model to preselect: the server's default when it can be chosen, else the first that can. */
export function defaultSummaryModel(models: SummarizationModels | null): string | undefined {
  const choices = summaryModelChoices(models).filter((c) => !c.disabled)
  return choices.find((c) => c.id === models?.default)?.id ?? choices[0]?.id
}

export const SUMMARY_STATUS_LABEL: Record<SummarizationJobStatus, string> = {
  queued: 'Queued',
  processing: 'Summarising',
  complete: 'Done',
  error: 'Failed',
}

/** Whether following a request again cannot help: the server refused it (4xx).
 * A network error or a 5xx may pass, so polling goes on. */
export function isFinalRefusal(err: unknown): boolean {
  const status = (err as SummarizationError | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

/** What to tell the user when following a request fails. */
export function summaryFailureMessage(err: unknown): string {
  if ((err as SummarizationError | null)?.status === 404) {
    return 'This summary is no longer available. Requests expire after an hour. Start it again.'
  }
  return err instanceof Error && err.message ? err.message : 'Summarisation failed.'
}

/** Status colour for where a stored summary came from, beside `vmlb-status`. */
export function sourceBadgeClass(source: GenerationSource): string {
  switch (source) {
    case 'etl':
      return 'vmlb-status-training'
    case 'on_demand':
      return 'vmlb-status-pending'
    case 'regeneration':
      return 'vmlb-status-completed'
    default:
      return ''
  }
}

/** A locale date, or nothing for a missing or invalid one. */
export function formatSummaryDate(date?: string): string {
  if (!date) return ''
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}
