import { computed, onUnmounted, ref, type Ref } from 'vue'
import { count } from '../annotation/annotationState'
import { batchSummary, newestFirst } from '../annotation/llmAssist'
import type { Id, LlmAgreement, LlmEstimate, LlmJob, LlmKeyInput, LlmPrompt, LlmRefusalError, LlmStatus, LlmSuggestion, LlmSuggestionBatch, MLAdapter } from '../types'
import { createPollLoop, type PollLoop } from '../utils/polling'

/** Refusals after which the status on screen is out of date. */
const STATUS_CODES = ['no_llm_access', 'acknowledgement_required', 'destination_changed', 'credential_unusable']

/** The server answered that it doesn't know the job (a 404, or its "Job not found"). */
function jobNotFound(err: unknown): boolean {
  const failure = err as { status?: number; message?: string } | null
  return failure?.status === 404 || /\bjob not found\b/i.test(failure?.message ?? '')
}

/** A Dataset's LLM access and suggestions. Nothing is sent to an LLM until the
 * Project has acknowledged the destination the backend names. */
export function useLlmAssist(adapter: MLAdapter, pollIntervalMs = 3000) {
  const status = ref<LlmStatus | null>(null)
  /** Suggestions still waiting for a person. None of them is a label. */
  const suggestions = ref<LlmSuggestion[]>([])
  const agreement = ref<LlmAgreement | null>(null)
  const prompt = ref<LlmPrompt | null>(null)
  /** Why the backend refused a prompt edit, shown beside the editor. */
  const promptError = ref<string | null>(null)
  const error = ref<string | null>(null)
  /** The refusal's `code` behind `error`, when the adapter gave one. */
  const errorCode = ref<string | null>(null)
  /** The message of the refusal `errorCode` came with, whichever ref shows it. */
  const errorMessage = ref<string | null>(null)
  const notice = ref('')
  const isBusy = ref(false)
  /** The monthly limit of the shared key is used up. */
  const budgetExhausted = ref(false)
  /** A standalone job's estimate, the items it covers (all pending when
   * undefined), and the job once started. */
  const estimate = ref<LlmEstimate | null>(null)
  const job = ref<LlmJob | null>(null)
  /** The job being followed, so a host can pick it up again on a later visit. */
  const jobId = ref<Id | null>(null)
  let estimatedIds: Id[] | undefined
  let jobLoop: PollLoop | null = null
  /** The Dataset on screen. A reply about any other is dropped. */
  let currentId: Id | null = null

  /** The account may use an LLM key: their own, or the shared one while it
   * works. A shared key the usage meter cannot vouch for is not usable access,
   * so the panel offers an own key and nothing may spend the shared one. */
  function accessIn(next: LlmStatus | null): boolean {
    return !!next && next.mode !== 'none' && (next.mode !== 'shared' || next.shared_key_available !== false)
  }
  const hasAccess = computed(() => accessIn(status.value))
  const ready = computed(() => hasAccess.value && !!status.value?.acknowledged)

  async function loadStatus(datasetId: Id) {
    const next = await adapter.getLlmStatus!(datasetId)
    if (datasetId !== currentId) return
    // What waits is read before the status changes, and both change together:
    // a new model on screen with the old model's list would find nothing
    // waiting for it and ask for a suggestion it already has.
    let progress: Awaited<ReturnType<typeof readProgress>> | null = null
    let failure: unknown = null
    if (accessIn(next) && next.acknowledged) {
      try {
        progress = await readProgress(datasetId)
      } catch (err) {
        failure = err
      }
      if (datasetId !== currentId) return
    }
    status.value = next
    // A refusal at the limit outlasts a status read; an own key ends it.
    budgetExhausted.value = next.mode === 'shared' && (next.remaining_tokens === 0 || budgetExhausted.value)
    if (progress) showProgress(progress)
    if (failure) throw failure
  }

  function readProgress(datasetId: Id) {
    return Promise.all([adapter.listLlmSuggestions?.(datasetId, 'pending'), adapter.getLlmAgreement?.(datasetId)])
  }

  function showProgress([waiting, check]: Awaited<ReturnType<typeof readProgress>>) {
    suggestions.value = waiting ?? []
    agreement.value = check ?? null
  }

  /** What is waiting, and how far the agreement check has got. */
  async function loadProgress(datasetId: Id) {
    const progress = await readProgress(datasetId)
    if (datasetId === currentId) showProgress(progress)
  }

  async function run(datasetId: Id, action: () => Promise<void>, fallback: string, errorRef: Ref<string | null> = error) {
    isBusy.value = true
    error.value = null
    errorCode.value = null
    errorMessage.value = null
    errorRef.value = null
    notice.value = ''
    try {
      await action()
    } catch (err) {
      const refusal = err as LlmRefusalError
      errorRef.value = err instanceof Error ? err.message : fallback
      errorCode.value = refusal?.code ?? null
      errorMessage.value = errorRef.value
      if (refusal?.code === 'budget_exhausted') budgetExhausted.value = true
      if (STATUS_CODES.includes(refusal?.code ?? '')) await loadStatus(datasetId).catch(() => undefined)
    } finally {
      isBusy.value = false
    }
  }

  function refresh(datasetId: Id) {
    if (datasetId !== currentId) {
      stopJob()
      suggestions.value = []
      agreement.value = null
      prompt.value = null
      estimate.value = null
      job.value = null
      jobId.value = null
    }
    currentId = datasetId
    return run(datasetId, () => loadStatus(datasetId), 'Failed to load LLM access')
  }

  /** The key goes straight to the adapter and is not kept here. */
  function saveKey(datasetId: Id, key: LlmKeyInput) {
    return run(datasetId, async () => {
      await adapter.saveLlmKey!(key)
      await loadStatus(datasetId)
      notice.value = 'Your key is saved. It is never shown again.'
    }, 'Failed to save your key')
  }

  function deleteKey(datasetId: Id) {
    return run(datasetId, async () => {
      await adapter.deleteLlmKey!()
      await loadStatus(datasetId)
      notice.value = 'Your key is deleted.'
    }, 'Failed to delete your key')
  }

  /** Names the destination the user was shown, so a stale screen can't agree to another. */
  function acknowledge(datasetId: Id) {
    return run(datasetId, async () => {
      await adapter.acknowledgeLlmDestination!(datasetId, status.value!.destination!)
      await loadStatus(datasetId)
    }, 'Failed to save your confirmation')
  }

  /** After a label was saved elsewhere: what is waiting and the check may have changed. */
  async function refreshProgress(datasetId: Id) {
    if (!ready.value) return
    try {
      await loadProgress(datasetId)
    } catch {
      // A stale count is shown until the next refresh; the label itself was saved.
    }
  }

  /** How many suggestions the last bulk accept made labels, as the server counted them. */
  const acceptedCount = ref<number | null>(null)

  /** Resolves true when suggestions became labels; `acceptedCount` says how many. */
  async function bulkAccept(datasetId: Id) {
    let accepted = false
    acceptedCount.value = null
    await run(datasetId, async () => {
      try {
        const result = await adapter.bulkAcceptLlmSuggestions!(datasetId)
        accepted = true
        acceptedCount.value = result.accepted
        notice.value = `${count(result.accepted, 'suggestion')} accepted.`
      } finally {
        await loadProgress(datasetId).catch(() => undefined)
      }
    }, 'Failed to accept the suggestions')
    return accepted
  }

  function suggest(datasetId: Id, taskIds: () => Promise<Id[]>) {
    return run(datasetId, async () => {
      const batch = await adapter.createLlmSuggestions!(datasetId, await taskIds())
      await loadStatus(datasetId)
      notice.value = batchSummary({ created: batch.suggestions.length, skipped: batch.skipped, invalid: batch.invalid })
    }, 'Failed to get suggestions')
  }

  /** Why the last one-item suggestion failed, for the guide's Try it. */
  const suggestError = ref<string | null>(null)

  /** One item's suggestion, for the guide's Try it: what came back, or null
   * when the request failed (the reason in `suggestError`). The new suggestion
   * joins what is waiting, first, so it is the item's current one. */
  async function suggestOne(datasetId: Id, taskId: Id): Promise<LlmSuggestionBatch | null> {
    let batch: LlmSuggestionBatch | null = null
    await run(datasetId, async () => {
      const result = await adapter.createLlmSuggestions!(datasetId, [taskId])
      if (datasetId !== currentId) return
      batch = result
      const created = result.suggestions.filter((s) => s.status === 'pending')
      suggestions.value = newestFirst([...created, ...suggestions.value.filter((s) => !created.some((c) => c.id === s.id))])
    }, "The AI didn't answer", suggestError)
    // Set inside the callback, which narrowing can't see.
    return batch as LlmSuggestionBatch | null
  }

  function loadPrompt(datasetId: Id) {
    return run(datasetId, async () => {
      const next = await adapter.getLlmPrompt!(datasetId)
      if (datasetId === currentId) prompt.value = next
    }, 'Failed to load the prompt', promptError)
  }

  /** The backend checks the edit, with an LLM among its checks, before it keeps it. */
  function savePrompt(datasetId: Id, edit: { template: string; definitions: Record<string, string> }) {
    return run(datasetId, async () => {
      prompt.value = await adapter.updateLlmPrompt!(datasetId, edit)
      await loadStatus(datasetId)
      notice.value = `Saved as version ${prompt.value.version}. The agreement check starts again for it.`
    }, 'Failed to save the prompt', promptError)
  }

  function stopJob() {
    jobLoop?.stop()
    jobLoop = null
  }

  /** Nothing is sent: the backend counts tokens for the items. */
  function estimateJob(datasetId: Id, taskIds: () => Promise<Id[] | undefined>) {
    return run(datasetId, async () => {
      estimate.value = null
      job.value = null
      const ids = await taskIds()
      const next = await adapter.estimateLlmAnnotation!(datasetId, ids)
      if (datasetId !== currentId) return
      estimatedIds = ids
      estimate.value = next
    }, 'Failed to estimate the cost')
  }

  function clearEstimate() {
    estimate.value = null
  }

  /** Reads the job once; resolves false when it has finished. */
  async function readJob(datasetId: Id, id: Id): Promise<boolean> {
    const next = await adapter.getLlmJob!(id)
    if (datasetId !== currentId || jobId.value !== id) return false
    job.value = next
    if (next.status === 'queued' || next.status === 'running') return true
    stopJob()
    if (next.status === 'budget_exhausted') budgetExhausted.value = true
    await loadStatus(datasetId).catch(() => undefined)
    return false
  }

  function followJob(datasetId: Id, id: Id) {
    stopJob()
    jobLoop = createPollLoop(async () => {
      if (datasetId !== currentId) return stopJob()
      await readJob(datasetId, id)
    }, pollIntervalMs)
    jobLoop.start()
  }

  /** Starts the job on the items it estimated, then follows it on the worker. */
  function startJob(datasetId: Id) {
    return run(datasetId, async () => {
      const { job_id: id, estimate: confirmed } = await adapter.startLlmAnnotation!(datasetId, estimatedIds)
      estimate.value = null
      jobId.value = id
      job.value = { status: 'queued', total: confirmed.tasks, done: 0 }
      followJob(datasetId, id)
    }, 'Failed to start labelling')
  }

  /** Picks up a job started on an earlier visit, from the worker's own
   * record of it. Resolves false when the server no longer knows the job; a
   * read that failed otherwise (the network) keeps following it. */
  async function resumeJob(datasetId: Id, id: Id): Promise<boolean> {
    jobId.value = id
    try {
      if (await readJob(datasetId, id)) followJob(datasetId, id)
      return true
    } catch (err) {
      if (!jobNotFound(err)) {
        if (jobId.value === id) followJob(datasetId, id)
        return true
      }
      if (jobId.value === id) jobId.value = null
      return false
    }
  }

  /** Forgets the job on screen, e.g. once its labels are accepted. */
  function clearJob() {
    stopJob()
    job.value = null
    jobId.value = null
  }

  onUnmounted(stopJob)

  return {
    status, suggestions, agreement, prompt, promptError, error, errorCode, errorMessage, notice, isBusy, budgetExhausted, hasAccess, ready,
    estimate, job, jobId, acceptedCount,
    refresh, refreshProgress, saveKey, deleteKey, acknowledge, suggest, bulkAccept, loadPrompt, savePrompt,
    suggestOne, suggestError,
    estimateJob, clearEstimate, startJob, resumeJob, clearJob,
  }
}
