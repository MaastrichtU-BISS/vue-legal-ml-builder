/** Model metrics are loosely typed (accuracy/precision/recall/f1_score are
 * numbers, but confusion_matrix/classification_report/etc. vary by model
 * family) — this narrows a single numeric field for display. */
export function numericMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The label each score is shown under, in the order a no-code user reads them. */
export const SCORE_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  precision: 'Precision',
  recall: 'Recall',
  f1_score: 'F1',
  rouge1: 'ROUGE-1',
  rouge2: 'ROUGE-2',
  rougeL: 'ROUGE-L',
}

export interface ScoreRow {
  key: string
  label: string
  text: string
}

/** The scores a model reports, ready to render: whichever of `keys` are finite
 * numbers, as percentages with `digits` decimals. A missing or NaN score is
 * left out rather than shown as a blank or NaN. */
export function scoreRows(
  metrics: Record<string, unknown> | null | undefined,
  keys: string[],
  digits = 2,
): ScoreRow[] {
  return keys.flatMap((key) => {
    const value = numericMetric(metrics, key)
    return value === undefined ? [] : [{ key, label: SCORE_LABELS[key] ?? key, text: `${(value * 100).toFixed(digits)}%` }]
  })
}
