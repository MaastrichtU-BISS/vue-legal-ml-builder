import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { useLlmAssist } from '../src/composables/useLlmAssist'
import type { LlmEstimate, LlmStatus } from '../src/types'
import { createTestAdapter } from './testAdapter'
import { llmMethods, llmStatus, llmSuggestion } from './fixtures/llm'

/** A promise and the function that settles it, for replies that arrive out of order. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('useLlmAssist: reading the status', () => {
  it('still shows the new status when what waits fails to read, and says so', async () => {
    const adapter = createTestAdapter(llmMethods({
      getLlmStatus: vi.fn().mockResolvedValue(llmStatus({ model: 'gpt-x' })),
      listLlmSuggestions: vi.fn().mockRejectedValue(new Error('Server error')),
    }))
    const llm = useLlmAssist(adapter)

    await llm.refresh('ds-1')

    expect(llm.status.value?.model).toBe('gpt-x')
    expect(llm.error.value).toBe('Server error')
  })

  it('keeps the newer status when an older read finishes after it', async () => {
    const older = deferred<LlmStatus>()
    const getLlmStatus = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockResolvedValue(llmStatus({ mode: 'byok', model: 'gpt-x' }))
    const listLlmSuggestions = vi.fn().mockResolvedValue([llmSuggestion({ model: 'gpt-x' })])
    const adapter = createTestAdapter(llmMethods({ getLlmStatus, listLlmSuggestions }))
    const llm = useLlmAssist(adapter)

    // The first read is still out when a key is saved and the status read again.
    const first = llm.refresh('ds-1')
    await llm.saveKey('ds-1', { base_url: 'https://api.example.com/v1', model: 'gpt-x', api_key: 'sk-own' })
    expect(llm.status.value?.model).toBe('gpt-x')

    listLlmSuggestions.mockResolvedValue([])
    older.resolve(llmStatus())
    await first
    await flushPromises()

    expect(llm.status.value?.model).toBe('gpt-x')
    expect(llm.suggestions.value.map((s) => s.model)).toEqual(['gpt-x'])
  })
})

describe('useLlmAssist: Do the rest (BAIGLE #213)', () => {
  it('shows a finished job only once the suggestions it made are read', async () => {
    let finished = false
    const listLlmSuggestions = vi.fn(async () => (finished ? [llmSuggestion()] : []))
    const getLlmJob = vi.fn(async () => {
      finished = true
      return { status: 'completed' as const, total: 1, done: 1, created: 1 }
    })
    const adapter = createTestAdapter(llmMethods({ listLlmSuggestions, getLlmJob }))
    const llm = useLlmAssist(adapter)
    await llm.refresh('ds-1')
    const seen: number[] = []
    watch(llm.job, (job) => {
      if (job?.status === 'completed') seen.push(llm.suggestions.value.length)
    }, { flush: 'sync' })

    await llm.resumeJob('ds-1', 'job-1')

    expect(seen).toEqual([1])
  })

  it('drops an estimate that comes back after it was cleared', async () => {
    const reply = deferred<LlmEstimate>()
    const adapter = createTestAdapter(llmMethods({ estimateLlmAnnotation: vi.fn(() => reply.promise) }))
    const llm = useLlmAssist(adapter)
    await llm.refresh('ds-1')

    const asked = llm.estimateJob('ds-1', async () => ['t1'])
    await flushPromises()
    llm.clearEstimate()
    reply.resolve({ tasks: 1, estimated_tokens: 100, remaining_tokens: 1000, within_budget: true, destination: 'openrouter.ai' })
    await asked

    expect(llm.estimate.value).toBeNull()
  })
})
