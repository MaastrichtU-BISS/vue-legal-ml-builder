import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockAdapter } from '../src/demo/mockAdapter'

afterEach(() => {
  vi.useRealTimers()
})

describe('the demo adapter', () => {
  it('produces grouped points for a training run, with fine-tuning steps', async () => {
    vi.useFakeTimers()
    const adapter = createMockAdapter()
    const started = adapter.startTraining('seed-svm-3')
    await vi.advanceTimersByTimeAsync(60_000)
    const { job_id } = await started

    const metrics = adapter.getTrainingMetrics(job_id, -1)
    await vi.advanceTimersByTimeAsync(1_000)
    const points = await metrics

    expect(new Set(points.map((p) => p.group))).toEqual(new Set(['stage', 'train', 'eval']))
    const curve = points.filter((p) => p.group === 'train')
    expect(curve.length).toBeGreaterThan(3)
    expect(curve.every((p) => typeof p.training_step === 'number')).toBe(true)
    expect(points.filter((p) => p.group === 'stage').every((p) => p.training_step === null)).toBe(true)
  })
})

describe('the demo adapter summarization', () => {
  async function settle<T>(promise: Promise<T>) {
    await vi.advanceTimersByTimeAsync(1_000)
    return promise
  }

  it('queues a summary, then reports it processing, then complete', async () => {
    vi.useFakeTimers()
    const adapter = createMockAdapter()

    const queued = await settle(adapter.summarize!({ input_text: 'First sentence. Second one. Third one.', summary_length: 'short' }))
    expect(queued).toMatchObject({ status: 'queued', progress: 0, summarized_text: null })

    const statuses = []
    for (let i = 0; i < 3; i++) statuses.push(await settle(adapter.getSummarizationJob!(queued.request_id)))

    expect(statuses.map((s) => s.status)).toEqual(['processing', 'processing', 'complete'])
    expect(statuses[2]).toMatchObject({ progress: 100, summarized_text: 'First sentence.', error: null })
  })

  it('answers an unknown request with a 404, as the server does', async () => {
    const adapter = createMockAdapter()

    const refused = await adapter.getSummarizationJob!('nope').catch((err) => err)

    expect(refused.status).toBe(404)
  })

  it('offers extractive models, with abstractive ones unavailable', async () => {
    vi.useFakeTimers()
    const models = await settle(createMockAdapter().getSummarizationModels!())

    expect(models.default).toBe('lex_rank')
    expect(models.abstractive_available).toBe(false)
    expect(models.abstractive.every((m) => m.id.startsWith('hf:'))).toBe(true)
  })
})
