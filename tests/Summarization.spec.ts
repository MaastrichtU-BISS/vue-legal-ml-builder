import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SummarizationWidget from '../src/components/summarization/SummarizationWidget.vue'
import SummaryExportPanel from '../src/components/summarization/SummaryExportPanel.vue'
import SummaryResultsPanel from '../src/components/summarization/SummaryResultsPanel.vue'
import { createTestAdapter } from './testAdapter'
import type { PersistedSummary, SummarizationJob, SummarizationModels, SummaryStoreAdapter } from '../src/types'

const MODELS: SummarizationModels = {
  default: 'lex_rank',
  abstractive_available: false,
  extractive: [
    { id: 'lex_rank', label: 'LexRank', description: 'Graph-based.' },
    { id: 'lsa', label: 'LSA', description: 'Topic-based.' },
  ],
  abstractive: [{ id: 'hf:facebook/bart-large-cnn', label: 'BART', description: 'Writes new text.' }],
}

function job(overrides: Partial<SummarizationJob> = {}): SummarizationJob {
  return { request_id: 'r1', status: 'queued', progress: 0, summarized_text: null, error: null, ...overrides }
}

function summarizing(...polls: Array<SummarizationJob | Error>) {
  let call = 0
  return createTestAdapter({
    summarize: vi.fn().mockResolvedValue(job()),
    getSummarizationJob: vi.fn().mockImplementation(async () => {
      const answer = polls[Math.min(call++, polls.length - 1)]
      if (answer instanceof Error) throw answer
      return answer
    }),
    getSummarizationModels: vi.fn().mockResolvedValue(MODELS),
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SummarizationWidget', () => {
  it('says summarisation is unavailable when the adapter has none', async () => {
    const wrapper = mount(SummarizationWidget, { props: { adapter: createTestAdapter() } })
    await flushPromises()

    expect(wrapper.text()).toContain('Summarisation is not available')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('fills the model picker from the server, with abstractive models disabled', async () => {
    const wrapper = mount(SummarizationWidget, { props: { adapter: summarizing(job()) } })
    await flushPromises()

    const options = wrapper.findAll('option')
    expect(options.map((o) => o.attributes('value'))).toEqual(['lex_rank', 'lsa', 'hf:facebook/bart-large-cnn'])
    expect(options[2].attributes('disabled')).toBeDefined()
    expect(options[0].attributes('disabled')).toBeUndefined()
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('lex_rank')
    expect(wrapper.text()).toContain('Abstractive models are not available on this server.')
  })

  it('summarises pasted text with the chosen settings and shows the result', async () => {
    vi.useFakeTimers()
    const adapter = summarizing(job({ status: 'processing', progress: 50 }), job({ status: 'complete', progress: 100, summarized_text: 'Erasure must be prompt.' }))
    const wrapper = mount(SummarizationWidget, { props: { adapter, pollInterval: 10 } })
    await flushPromises()

    await wrapper.find('textarea').setValue('The data subject shall have the right to erasure.')
    await wrapper.find('select').setValue('lsa')
    await wrapper.findAll('button').find((b) => b.text() === 'Summarise')!.trigger('click')
    await flushPromises()

    expect(adapter.summarize).toHaveBeenCalledWith({
      input_text: 'The data subject shall have the right to erasure.',
      summary_length: 'medium',
      priority: { relevance: 0.5, readability: 0.5 },
      model: 'lsa',
    })
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Queued')

    await vi.advanceTimersByTimeAsync(10)
    expect(wrapper.text()).toContain('50%')

    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()
    expect(wrapper.text()).toContain('Erasure must be prompt.')
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('shows why a request ended when it expired', async () => {
    vi.useFakeTimers()
    const adapter = summarizing(Object.assign(new Error('Summarization request not found.'), { status: 404 }))
    const wrapper = mount(SummarizationWidget, { props: { adapter, pollInterval: 10 } })
    await flushPromises()

    await wrapper.find('textarea').setValue('Text.')
    await wrapper.findAll('button').find((b) => b.text() === 'Summarise')!.trigger('click')
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('Requests expire after an hour')
  })

  it('emits a result to save when saving is allowed', async () => {
    const adapter = createTestAdapter({
      summarize: vi.fn().mockResolvedValue(job({ status: 'complete', progress: 100, summarized_text: 'Short.' })),
      getSummarizationJob: vi.fn(),
    })
    const wrapper = mount(SummarizationWidget, { props: { adapter, allowSave: true } })
    await flushPromises()

    await wrapper.find('textarea').setValue('Text.')
    await wrapper.findAll('button').find((b) => b.text() === 'Summarise')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Save summary')!.trigger('click')

    expect(wrapper.emitted('save')?.[0]).toEqual([{ request_id: 'r1', summarized_text: 'Short.', document: undefined }])
  })
})

describe('summary store components', () => {
  const stored: PersistedSummary = {
    id: 5, document_id: 9, summary_text: 'Stored summary.', generation_source: 'etl', created_at: '2026-11-01T00:00:00Z',
  }

  function store(overrides: Partial<SummaryStoreAdapter> = {}): SummaryStoreAdapter {
    return {
      listSummaries: vi.fn().mockResolvedValue([stored]),
      getVersionHistory: vi.fn().mockResolvedValue([stored]),
      rejectSummary: vi.fn().mockResolvedValue({ ...stored, id: 6 }),
      ...overrides,
    }
  }

  it('lists stored summaries, naming documents from the list given', async () => {
    const wrapper = mount(SummaryResultsPanel, {
      props: { store: store(), taskId: 't1', documents: [{ id: '9', name: 'Lease', content: '' }] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Lease')
    expect(wrapper.text()).toContain('Stored summary.')
  })

  it('rejects a summary with the reason given and reloads', async () => {
    const s = store()
    const wrapper = mount(SummaryResultsPanel, { props: { store: s, taskId: 't1' } })
    await flushPromises()

    await wrapper.find('[aria-label="Reject summary"]').trigger('click')
    await wrapper.find('textarea').setValue('Misses the holding.')
    await wrapper.findAll('button').find((b) => b.text() === 'Reject and regenerate')!.trigger('click')
    await flushPromises()

    expect(s.rejectSummary).toHaveBeenCalledWith(5, 'Misses the holding.')
    expect(s.listSummaries).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('summary-updated')).toHaveLength(1)
  })

  it('exports from the current summaries when the store has no export', async () => {
    // jsdom has no object URLs; stand in for the browser's download.
    URL.createObjectURL = vi.fn(() => 'blob:summaries')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('summaries_t1.json')
    })
    const s = store()
    const wrapper = mount(SummaryExportPanel, { props: { store: s, taskId: 't1' } })

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(s.listSummaries).toHaveBeenCalledWith('t1')
    expect(click).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    click.mockRestore()
  })
})
