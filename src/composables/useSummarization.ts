import { computed, getCurrentInstance, onUnmounted, ref } from 'vue'
import { isFinalRefusal, summaryFailureMessage } from '../summarization/summaryDisplay'
import type {
  MLAdapter,
  SummarizationJob,
  SummarizationJobStatus,
  SummarizationModels,
  SummaryDocument,
  SummaryLength,
  SummaryPriority,
  SummaryResult,
} from '../types'
import { createPollLoop, type PollLoop } from '../utils/polling'

export interface SummaryInput {
  text: string
  document?: SummaryDocument
}

export interface SummarizeOptions {
  summaryLength?: SummaryLength
  priority?: SummaryPriority
  /** Left out, the server uses its default model. */
  model?: string
}

/** Polls failing in a row, without a refusal, before following a request stops. */
const MAX_FAILED_POLLS = 5

/** Summarises one or more texts in turn. Each request is queued with the
 * adapter's `summarize`, then polled with `getSummarizationJob` until it is
 * `complete` or `error`. A 404 (unknown or expired request) or another refusal
 * ends it at once; a network error or 5xx is retried on the next poll. */
export function useSummarization(adapter: MLAdapter, pollIntervalMs = 1500) {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const results = ref<SummaryResult[]>([])
  /** The request being followed: its status and 0..100 progress. */
  const status = ref<SummarizationJobStatus | null>(null)
  const progress = ref(0)
  const batchCompleted = ref(0)
  const batchTotal = ref(0)
  const models = ref<SummarizationModels | null>(null)
  const modelsError = ref<string | null>(null)

  /** Whether the adapter can summarise at all. */
  const available = typeof adapter.summarize === 'function' && typeof adapter.getSummarizationJob === 'function'

  const overallProgress = computed(() => {
    if (batchTotal.value > 1) {
      // The request being followed counts in part; a finished batch is 100.
      const current = batchCompleted.value < batchTotal.value ? progress.value / 100 : 0
      return Math.round(((batchCompleted.value + current) / batchTotal.value) * 100)
    }
    return progress.value
  })

  let loop: PollLoop | null = null
  let cancelWait: (() => void) | null = null
  /** The current run. A reply for an earlier one is dropped. */
  let run = 0

  function stopPolling() {
    loop?.stop()
    loop = null
    cancelWait?.()
    cancelWait = null
  }

  function show(job: SummarizationJob) {
    status.value = job.status
    progress.value = Math.max(0, Math.min(100, job.progress ?? 0))
  }

  /** Resolves with the finished job, or null when the run was cancelled. */
  function follow(requestId: string, runId: number): Promise<SummarizationJob | null> {
    return new Promise((resolve, reject) => {
      let failures = 0
      const settle = () => {
        cancelWait = null
        loop?.stop()
        loop = null
      }
      cancelWait = () => resolve(null)
      loop = createPollLoop(async () => {
        let job: SummarizationJob
        try {
          job = await adapter.getSummarizationJob!(requestId)
        } catch (err) {
          if (runId !== run) return
          failures++
          if (isFinalRefusal(err) || failures >= MAX_FAILED_POLLS) {
            settle()
            reject(err)
          }
          return
        }
        if (runId !== run) return
        failures = 0
        show(job)
        if (job.status === 'complete') {
          settle()
          resolve(job)
        } else if (job.status === 'error') {
          settle()
          reject(new Error(job.error || 'Summarisation failed.'))
        }
      }, pollIntervalMs)
      loop.start()
    })
  }

  async function summarizeOne(input: SummaryInput, options: SummarizeOptions, runId: number): Promise<SummaryResult | null> {
    const queued = await adapter.summarize!({
      input_text: input.text,
      ...(options.summaryLength !== undefined ? { summary_length: options.summaryLength } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
      ...(options.model ? { model: options.model } : {}),
    })
    if (runId !== run) return null
    show(queued)
    let done: SummarizationJob | null = queued
    if (queued.status === 'error') throw new Error(queued.error || 'Summarisation failed.')
    if (queued.status !== 'complete') done = await follow(queued.request_id, runId)
    if (!done) return null
    return { request_id: done.request_id, summarized_text: done.summarized_text ?? '', document: input.document }
  }

  /** Summarises each input in turn. `error` says why a run stopped. */
  async function summarize(inputs: SummaryInput[], options: SummarizeOptions = {}): Promise<void> {
    if (!available) {
      error.value = 'Summarisation is not available.'
      return
    }
    stopPolling()
    const runId = ++run
    isLoading.value = true
    error.value = null
    results.value = []
    status.value = null
    progress.value = 0
    batchCompleted.value = 0
    batchTotal.value = inputs.length
    try {
      for (const input of inputs) {
        const result = await summarizeOne(input, options, runId)
        if (!result || runId !== run) return
        results.value.push(result)
        batchCompleted.value++
        progress.value = 0
      }
      progress.value = 100
    } catch (err) {
      if (runId === run) error.value = summaryFailureMessage(err)
    } finally {
      if (runId === run) isLoading.value = false
    }
  }

  /** Stops following the current request and clears what is shown. */
  function reset() {
    run++
    stopPolling()
    isLoading.value = false
    error.value = null
    results.value = []
    status.value = null
    progress.value = 0
    batchCompleted.value = 0
    batchTotal.value = 0
  }

  async function loadModels() {
    if (!adapter.getSummarizationModels) return
    modelsError.value = null
    try {
      models.value = await adapter.getSummarizationModels()
    } catch (err) {
      modelsError.value = err instanceof Error ? err.message : 'Failed to load the models'
    }
  }

  if (getCurrentInstance()) onUnmounted(reset)

  return {
    available, isLoading, error, results, status, progress, overallProgress, batchCompleted, batchTotal,
    models, modelsError, summarize, reset, loadModels,
  }
}
