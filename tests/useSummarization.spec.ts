import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSummarization } from '../src/composables/useSummarization'
import { defaultSummaryModel, summaryModelChoices } from '../src/summarization/summaryDisplay'
import { buildExport } from '../src/summarization/exportSummaries'
import { createTestAdapter } from './testAdapter'
import type { SummarizationError, SummarizationJob } from '../src/types'

function job(overrides: Partial<SummarizationJob> = {}): SummarizationJob {
  return { request_id: 'r1', status: 'queued', progress: 0, summarized_text: null, error: null, ...overrides }
}

function refusal(status: number, message: string): SummarizationError {
  return Object.assign(new Error(message), { status })
}

/** An adapter whose polls answer in turn, the last answer repeating. */
function polling(...answers: Array<SummarizationJob | Error>) {
  let call = 0
  return createTestAdapter({
    summarize: vi.fn().mockResolvedValue(job()),
    getSummarizationJob: vi.fn().mockImplementation(async () => {
      const answer = answers[Math.min(call++, answers.length - 1)]
      if (answer instanceof Error) throw answer
      return answer
    }),
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useSummarization', () => {
  it('follows a request from queued through processing to complete, then stops polling', async () => {
    vi.useFakeTimers()
    const adapter = polling(job({ status: 'processing', progress: 40 }), job({ status: 'complete', progress: 100, summarized_text: 'Rent is due monthly.' }))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'The tenant shall pay rent.' }], { summaryLength: 'short', priority: { relevance: 0.7 }, model: 'lsa' })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.status.value).toBe('queued')
    expect(s.isLoading.value).toBe(true)
    expect(adapter.summarize).toHaveBeenCalledWith({ input_text: 'The tenant shall pay rent.', summary_length: 'short', priority: { relevance: 0.7 }, model: 'lsa' })

    await vi.advanceTimersByTimeAsync(10)
    expect(s.status.value).toBe('processing')
    expect(s.progress.value).toBe(40)

    await vi.advanceTimersByTimeAsync(10)
    await done
    expect(s.status.value).toBe('complete')
    expect(s.results.value).toEqual([{ request_id: 'r1', summarized_text: 'Rent is due monthly.', document: undefined }])
    expect(s.isLoading.value).toBe(false)
    expect(s.error.value).toBeNull()

    const polls = (adapter.getSummarizationJob as any).mock.calls.length
    await vi.advanceTimersByTimeAsync(100)
    expect((adapter.getSummarizationJob as any).mock.calls.length).toBe(polls)
    expect(adapter.getSummarizationJob).toHaveBeenCalledWith('r1')
  })

  it('leaves out the model when none is chosen, so the server uses its default', async () => {
    vi.useFakeTimers()
    const adapter = polling(job({ status: 'complete', progress: 100, summarized_text: 'x' }))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'Text.' }])
    await vi.advanceTimersByTimeAsync(10)
    await done

    expect(adapter.summarize).toHaveBeenCalledWith({ input_text: 'Text.' })
  })

  it('shows the error the job ends with, and stops polling', async () => {
    vi.useFakeTimers()
    const adapter = polling(job({ status: 'processing', progress: 20 }), job({ status: 'error', progress: 20, error: 'Model failed to load.' }))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'Text.' }])
    await vi.advanceTimersByTimeAsync(20)
    await done

    expect(s.status.value).toBe('error')
    expect(s.error.value).toBe('Model failed to load.')
    expect(s.results.value).toEqual([])
    expect(s.isLoading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(adapter.getSummarizationJob).toHaveBeenCalledTimes(2)
  })

  it('stops at once on a 404 and says the request expired', async () => {
    vi.useFakeTimers()
    const adapter = polling(job({ status: 'processing', progress: 50 }), refusal(404, 'Summarization request not found.'))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'Text.' }])
    await vi.advanceTimersByTimeAsync(20)
    await done

    expect(s.error.value).toBe('This summary is no longer available. Requests expire after an hour. Start it again.')
    expect(s.isLoading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(adapter.getSummarizationJob).toHaveBeenCalledTimes(2)
  })

  it('keeps polling through a transient failure', async () => {
    vi.useFakeTimers()
    const adapter = polling(new Error('Failed to fetch'), job({ status: 'complete', progress: 100, summarized_text: 'Done.' }))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'Text.' }])
    await vi.advanceTimersByTimeAsync(20)
    await done

    expect(s.error.value).toBeNull()
    expect(s.results.value.map((r) => r.summarized_text)).toEqual(['Done.'])
  })

  it('gives up after repeated transient failures', async () => {
    vi.useFakeTimers()
    const adapter = polling(refusal(503, 'Service unavailable'))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'Text.' }])
    await vi.advanceTimersByTimeAsync(100)
    await done

    expect(s.error.value).toBe('Service unavailable')
    expect(adapter.getSummarizationJob).toHaveBeenCalledTimes(5)
  })

  it('shows the reason the server refuses the input', async () => {
    const adapter = createTestAdapter({
      summarize: vi.fn().mockRejectedValue(refusal(400, 'input_text is required.')),
      getSummarizationJob: vi.fn(),
    })
    const s = useSummarization(adapter, 10)

    await s.summarize([{ text: ' ' }])

    expect(s.error.value).toBe('input_text is required.')
    expect(adapter.getSummarizationJob).not.toHaveBeenCalled()
  })

  it('summarises a batch in turn and reports progress across it', async () => {
    vi.useFakeTimers()
    let n = 0
    const adapter = createTestAdapter({
      summarize: vi.fn().mockImplementation(async () => job({ request_id: `r${++n}` })),
      getSummarizationJob: vi.fn().mockImplementation(async (id: string) => job({ request_id: id, status: 'complete', progress: 100, summarized_text: `sum ${id}` })),
    })
    const s = useSummarization(adapter, 10)
    const docs = [{ id: 'a', name: 'A', content: 'a' }, { id: 'b', name: 'B', content: 'b' }]

    const done = s.summarize(docs.map((d) => ({ text: d.content, document: d })))
    await vi.advanceTimersByTimeAsync(10)
    expect(s.batchCompleted.value).toBe(1)
    expect(s.overallProgress.value).toBe(50)
    await vi.advanceTimersByTimeAsync(10)
    await done

    expect(s.results.value).toEqual([
      { request_id: 'r1', summarized_text: 'sum r1', document: docs[0] },
      { request_id: 'r2', summarized_text: 'sum r2', document: docs[1] },
    ])
    expect(s.overallProgress.value).toBe(100)
  })

  it('stops following a request on reset', async () => {
    vi.useFakeTimers()
    const adapter = polling(job({ status: 'processing', progress: 10 }))
    const s = useSummarization(adapter, 10)

    const done = s.summarize([{ text: 'Text.' }])
    await vi.advanceTimersByTimeAsync(10)
    s.reset()
    await done

    const polls = (adapter.getSummarizationJob as any).mock.calls.length
    await vi.advanceTimersByTimeAsync(100)
    expect((adapter.getSummarizationJob as any).mock.calls.length).toBe(polls)
    expect(s.isLoading.value).toBe(false)
    expect(s.status.value).toBeNull()
    expect(s.error.value).toBeNull()
  })

  it('says summarisation is unavailable for an adapter without it', async () => {
    const s = useSummarization(createTestAdapter())

    expect(s.available).toBe(false)
    await s.summarize([{ text: 'Text.' }])
    expect(s.error.value).toBe('Summarisation is not available.')
  })

  it('loads the models, and keeps the reason when it cannot', async () => {
    const models = { default: 'lex_rank', abstractive_available: false, extractive: [], abstractive: [] }
    const ok = useSummarization(createTestAdapter({ getSummarizationModels: vi.fn().mockResolvedValue(models) }))
    await ok.loadModels()
    expect(ok.models.value).toEqual(models)

    const failing = useSummarization(createTestAdapter({ getSummarizationModels: vi.fn().mockRejectedValue(new Error('Down')) }))
    await failing.loadModels()
    expect(failing.models.value).toBeNull()
    expect(failing.modelsError.value).toBe('Down')
  })
})

describe('summary model choices', () => {
  const models = {
    default: 'lex_rank',
    abstractive_available: false,
    extractive: [{ id: 'lex_rank', label: 'LexRank', description: '' }, { id: 'lsa', label: 'LSA', description: '' }],
    abstractive: [{ id: 'hf:facebook/bart-large-cnn', label: 'BART', description: '' }],
  }

  it('disables abstractive models while the server has none available', () => {
    expect(summaryModelChoices(models).map((c) => [c.id, c.kind, c.disabled])).toEqual([
      ['lex_rank', 'extractive', false],
      ['lsa', 'extractive', false],
      ['hf:facebook/bart-large-cnn', 'abstractive', true],
    ])
    expect(summaryModelChoices({ ...models, abstractive_available: true }).every((c) => !c.disabled)).toBe(true)
  })

  it('preselects the default, or the first model that can be chosen', () => {
    expect(defaultSummaryModel(models)).toBe('lex_rank')
    expect(defaultSummaryModel({ ...models, default: 'hf:facebook/bart-large-cnn' })).toBe('lex_rank')
    expect(defaultSummaryModel(null)).toBeUndefined()
  })
})

describe('buildExport', () => {
  const rows = [{ id: 1, document_id: 7, documents: { name: 'Lease' }, summary_text: 'Says "pay", on time\nmonthly', generation_source: 'etl', created_at: '2026-11-01' }]

  it('writes CSV with quoted values and the joined document name', () => {
    const { content, mimeType } = buildExport(rows, 'csv')
    expect(mimeType).toBe('text/csv')
    expect(content.split('\n')[0]).toBe('id,document_id,document_name,summary_text,version_number,generation_source,from_cache,created_at')
    expect(content).toContain('1,7,Lease,"Says ""pay"", on time\nmonthly",,etl,,2026-11-01')
  })

  it('writes JSON as given', () => {
    expect(JSON.parse(buildExport(rows, 'json').content)).toEqual(rows)
  })
})
