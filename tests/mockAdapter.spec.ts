import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_ANNOTATION_DATASET, createMockAdapter } from '../src/demo/mockAdapter'
import { demoSuggestion } from '../src/demo/demoClauses'
import { DEMO_LLM_DESTINATION } from '../src/demo/mockLlm'
import type { LlmRefusalError, MLAdapter } from '../src/types'

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

describe('the demo LLM', () => {
  const ds = DEMO_ANNOTATION_DATASET
  let adapter: MLAdapter

  /** Runs the adapter's delays out and returns what it resolved to. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(1_000)
    return promise
  }

  async function refused(promise: Promise<unknown>): Promise<LlmRefusalError> {
    const caught = promise.catch((err) => err)
    await vi.advanceTimersByTimeAsync(1_000)
    return caught
  }

  async function pendingIds(count: number) {
    const tasks = await settle(adapter.listAnnotationTasks!('demo-project', { status: 'pending', datasetId: ds }))
    return tasks.slice(0, count).map((t) => t.id)
  }

  async function acknowledge() {
    await settle(adapter.acknowledgeLlmDestination!(ds, DEMO_LLM_DESTINATION))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    adapter = createMockAdapter()
  })

  it('answers with a keyword rule, with a reason', () => {
    const labels = ['Obligation', 'Permission', 'Prohibition']
    expect(demoSuggestion('The tenant shall not sublet.', labels).label).toBe('Prohibition')
    expect(demoSuggestion('The tenant may not smoke.', labels).label).toBe('Prohibition')
    expect(demoSuggestion('The tenant must pay rent.', labels).label).toBe('Obligation')
    expect(demoSuggestion('The tenant may keep a cat.', labels).label).toBe('Permission')
    expect(demoSuggestion('This lease is governed by Dutch law.', labels)).toEqual({
      label: 'Obligation',
      rationale: 'No modal verb, so the first label.',
    })
    expect(demoSuggestion('The tenant must pay rent.', labels).rationale).toBe('"must" imposes a duty.')
  })

  it('reports the shared key, its budget and whether the Dataset acknowledged it', async () => {
    const status = await settle(adapter.getLlmStatus!(ds))
    expect(status).toMatchObject({
      mode: 'shared',
      destination: DEMO_LLM_DESTINATION,
      model: 'demo-llm',
      remaining_tokens: 200_000,
      max_sync_tasks: 10,
      acknowledged: false,
    })

    const ids = await pendingIds(1)
    expect((await refused(adapter.createLlmSuggestions!(ds, ids))).code).toBe('acknowledgement_required')
    expect((await refused(adapter.acknowledgeLlmDestination!(ds, 'Somewhere else'))).code).toBe('destination_changed')

    await acknowledge()
    expect((await settle(adapter.getLlmStatus!(ds))).acknowledged).toBe(true)
    expect((await settle(adapter.getLlmStatus!('ds-1'))).acknowledged).toBe(false)
  })

  it('suggests labels for at most ten items, which stay unlabelled, and uses tokens', async () => {
    await acknowledge()
    const ids = await pendingIds(10)
    const batch = await settle(adapter.createLlmSuggestions!(ds, ids))

    expect(batch.suggestions).toHaveLength(10)
    expect(batch.suggestions[0]).toMatchObject({ task_id: 'task-1', model: 'demo-llm', prompt_version: 0, label: 'Obligation', status: 'pending' })
    expect(batch.suggestions[2]).toMatchObject({ label: 'Prohibition', rationale: '"shall not" forbids the act.' })
    expect((await settle(adapter.getLlmStatus!(ds))).remaining_tokens).toBeLessThan(200_000)
    expect(await pendingIds(40)).toHaveLength(40)

    const again = await settle(adapter.createLlmSuggestions!(ds, ids))
    expect(again).toMatchObject({ suggestions: [], skipped: 10, invalid: 0 })
    await expect(refused(adapter.createLlmSuggestions!(ds, await pendingIds(11)))).resolves.toBeInstanceOf(Error)
    expect(await settle(adapter.listLlmSuggestions!(ds, 'pending'))).toHaveLength(10)
  })

  it('confirms, corrects and rejects suggestions, and counts them in the agreement', async () => {
    await acknowledge()
    const [accepted, corrected, rejected] = (await settle(adapter.createLlmSuggestions!(ds, await pendingIds(3)))).suggestions

    const yes = await settle(adapter.confirmLlmSuggestion!(accepted.id))
    expect(yes.suggestion.status).toBe('accepted')
    expect(yes.task).toMatchObject({ status: 'annotated', annotation_label: accepted.label, label_source: 'llm_confirmed' })

    const fixed = await settle(adapter.confirmLlmSuggestion!(corrected.id, 'Prohibition'))
    expect(fixed.suggestion.status).toBe('corrected')
    expect(fixed.task).toMatchObject({ annotation_label: 'Prohibition', label_source: 'human' })

    expect((await refused(adapter.confirmLlmSuggestion!(rejected.id, 'Nonsense'))).message).toMatch(/isn't one of/)
    expect((await settle(adapter.rejectLlmSuggestion!(rejected.id))).status).toBe('rejected')
    expect(await pendingIds(1)).toEqual([rejected.task_id])

    expect(await settle(adapter.getLlmAgreement!(ds))).toMatchObject({
      model: 'demo-llm', prompt_version: 0, checked: 2, agreed: 1, rate: 0.5, min_sample: 30, threshold: 0.8, unlocked: false,
    })
  })

  it('unlocks bulk accept at 30 checked items with 80% agreement', async () => {
    await acknowledge()
    const all = await pendingIds(40)
    for (let i = 0; i < 40; i += 10) await settle(adapter.createLlmSuggestions!(ds, all.slice(i, i + 10)))
    const waiting = await settle(adapter.listLlmSuggestions!(ds, 'pending'))
    expect(waiting).toHaveLength(40)

    expect((await refused(adapter.bulkAcceptLlmSuggestions!(ds))).code).toBe('agreement_not_met')
    for (const suggestion of waiting.slice(0, 30)) await settle(adapter.confirmLlmSuggestion!(suggestion.id))
    expect(await settle(adapter.getLlmAgreement!(ds))).toMatchObject({ checked: 30, rate: 1, unlocked: true })

    const result = await settle(adapter.bulkAcceptLlmSuggestions!(ds))
    expect(result.accepted).toBe(10)
    expect(await pendingIds(40)).toEqual([])
    const labelled = await settle(adapter.listAnnotationTasks!('demo-project', { status: 'annotated', datasetId: ds }))
    expect(labelled.filter((t) => t.label_source === 'llm_bulk')).toHaveLength(10)
  })

  it('runs a bulk job from queued through running to completed', async () => {
    const estimate = await settle(adapter.estimateLlmAnnotation!(ds))
    expect(estimate).toMatchObject({ tasks: 40, remaining_tokens: 200_000, within_budget: true, destination: DEMO_LLM_DESTINATION })
    expect(estimate.estimated_tokens).toBeGreaterThan(0)

    expect((await refused(adapter.startLlmAnnotation!(ds))).code).toBe('acknowledgement_required')
    await acknowledge()
    const ids = await pendingIds(6)
    const { job_id: jobId, estimate: confirmed } = await settle(adapter.startLlmAnnotation!(ds, ids))
    expect(confirmed.tasks).toBe(6)

    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const job = await settle(adapter.getLlmJob!(jobId))
      seen.add(job.status)
      if (job.status === 'completed') break
    }
    expect([...seen]).toEqual(expect.arrayContaining(['running', 'completed']))
    expect(await settle(adapter.getLlmJob!(jobId))).toMatchObject({ status: 'completed', total: 6, done: 6, created: 6 })
    expect(await settle(adapter.listLlmSuggestions!(ds, 'pending'))).toHaveLength(6)
    expect(await pendingIds(40)).toHaveLength(40)
  })

  it("lists a free model, and stops a job on a free model's daily allowance, keeping what was made (BAIGLE #225)", async () => {
    const { models } = await settle(adapter.listLlmModels!({ base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-demo' }))
    const free = models.filter((m) => m.free)
    expect(free.length).toBeGreaterThanOrEqual(2)
    expect(free.every((m) => m.id.endsWith(':free'))).toBe(true)
    const useModel = async (model: string) => {
      await settle(adapter.saveLlmKey!({ base_url: 'https://openrouter.ai/api/v1', model, api_key: 'sk-demo' }))
      await settle(adapter.acknowledgeLlmDestination!(ds, 'openrouter.ai'))
    }

    await useModel(free[0].id)
    expect(await settle(adapter.getLlmStatus!(ds))).toMatchObject({ mode: 'byok', free_model: true })
    // 30 of the day's 50 requests, shared by every free model, used on one model.
    const all = await pendingIds(40)
    for (const batch of [all.slice(0, 10), all.slice(10, 20), all.slice(20, 30)]) await settle(adapter.createLlmSuggestions!(ds, batch))

    // Another free model needs an answer on every item: 40, with 20 requests left today.
    await useModel(free[1].id)
    const estimate = await settle(adapter.estimateLlmAnnotation!(ds))
    expect(estimate).toMatchObject({
      tasks: 40, free_model: true, provider_daily_limit: 50, provider_daily_remaining: 20, provider_allowance_shared: false,
      over_provider_limit: true, within_budget: true,
    })

    const { job_id: jobId } = await settle(adapter.startLlmAnnotation!(ds))
    let job = await settle(adapter.getLlmJob!(jobId))
    for (let i = 0; i < 40 && (job.status === 'queued' || job.status === 'running'); i++) job = await settle(adapter.getLlmJob!(jobId))
    expect(job).toMatchObject({ status: 'provider_limited', total: 40, done: 20, created: 20, daily: true })
    expect(job.error).toContain('50 requests a day')
  })

  it("treats a :free id as free only at OpenRouter's address (BAIGLE #225 council)", async () => {
    await settle(adapter.saveLlmKey!({ base_url: 'https://api.mistral.ai/v1', model: 'mistral-small:free', api_key: 'sk-demo' }))
    expect(await settle(adapter.getLlmStatus!(ds))).toMatchObject({ mode: 'byok', free_model: false })
    await settle(adapter.acknowledgeLlmDestination!(ds, 'api.mistral.ai'))
    expect(await settle(adapter.estimateLlmAnnotation!(ds))).toMatchObject({ free_model: false, provider_daily_limit: null, over_provider_limit: false })
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

describe('the demo label set', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  async function settle<T>(promise: Promise<T>): Promise<T> {
    const settled = promise.then((value) => ({ value }), (error: Error) => ({ error }))
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await settled
    if ('error' in result) throw result.error
    return result.value
  }

  it('sets the labels of a Dataset with no used labels', async () => {
    const adapter = createMockAdapter()
    const dataset = await settle(adapter.setDatasetLabels!('ds-1', [' Civil', 'Criminal ']))
    expect(dataset.labels).toEqual(['Civil', 'Criminal'])
  })

  it('refuses fewer than two, repeated or empty names, as the server does', async () => {
    const adapter = createMockAdapter()
    await expect(settle(adapter.setDatasetLabels!('ds-1', ['Civil']))).rejects.toThrow('Use at least two labels.')
    await expect(settle(adapter.setDatasetLabels!('ds-1', ['Civil', 'Civil']))).rejects.toThrow('Two labels have the same name.')
    await expect(settle(adapter.setDatasetLabels!('ds-1', ['Civil', 'civil']))).rejects.toThrow('Two labels have the same name.')
    const many = Array.from({ length: 51 }, (_, i) => `Label ${i}`)
    await expect(settle(adapter.setDatasetLabels!('ds-1', many))).rejects.toThrow('Use at most 50 labels.')
    await expect(settle(adapter.setDatasetLabels!('ds-1', ['Civil', ' ']))).rejects.toThrow("Label names can't be empty.")
  })

  it('keeps every label already used on an item', async () => {
    const adapter = createMockAdapter()
    const { task } = await settle(adapter.getNextAnnotationTask('p1', DEMO_ANNOTATION_DATASET))
    const labels = (await settle(adapter.getDataset(DEMO_ANNOTATION_DATASET))).labels!
    await settle(adapter.saveAnnotation(task!.id, labels[0]))

    await expect(settle(adapter.setDatasetLabels!(DEMO_ANNOTATION_DATASET, labels.slice(1)))).rejects.toThrow(/already used/)
    const added = await settle(adapter.setDatasetLabels!(DEMO_ANNOTATION_DATASET, [...labels, 'Definition']))
    expect(added.labels).toEqual([...labels, 'Definition'])
    // Put the shared demo Dataset back as it was.
    await settle(adapter.setDatasetLabels!(DEMO_ANNOTATION_DATASET, labels))
  })
})
