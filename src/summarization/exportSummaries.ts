import type { ExportFormat } from '../types'

type Row = Record<string, any>

/** CSV columns for summary rows. Each reads one field, flattening a joined
 * document name; a field a row lacks is an empty cell. */
const CSV_COLUMNS: Array<{ header: string; get: (row: Row) => unknown }> = [
  { header: 'id', get: (r) => r.id },
  { header: 'document_id', get: (r) => r.document_id },
  { header: 'document_name', get: (r) => r.document_name ?? r.documents?.name ?? '' },
  { header: 'summary_text', get: (r) => r.summary_text },
  { header: 'version_number', get: (r) => r.version_number ?? '' },
  { header: 'generation_source', get: (r) => r.generation_source ?? '' },
  { header: 'from_cache', get: (r) => r.from_cache ?? '' },
  { header: 'created_at', get: (r) => r.created_at ?? '' },
]

function escapeCsv(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Quote a value holding a delimiter, quote or line break; double inner quotes.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialises rows for download in the format asked for. */
export function buildExport(rows: unknown[], format: ExportFormat): { content: string; mimeType: string } {
  if (format === 'csv') {
    const header = CSV_COLUMNS.map((c) => c.header).join(',')
    const body = (rows as Row[]).map((row) => CSV_COLUMNS.map((c) => escapeCsv(c.get(row ?? {}))).join(','))
    return { content: [header, ...body].join('\n'), mimeType: 'text/csv' }
  }
  return { content: JSON.stringify(rows, null, 2), mimeType: 'application/json' }
}

/** Builds the export and starts a browser download. Does nothing outside a browser. */
export function downloadExport(rows: unknown[], format: ExportFormat, filename: string): void {
  if (typeof document === 'undefined') return
  const { content, mimeType } = buildExport(rows, format)
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
