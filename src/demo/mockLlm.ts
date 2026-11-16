import type {
  AnnotationTask,
  Id,
  LlmAgreement,
  LlmEstimate,
  LlmJob,
  LlmPrompt,
  LlmRefusalError,
  LlmStatus,
  LlmSuggestion,
  LlmSuggestionBatch,
  MLAdapter,
} from '../types'
import { demoSuggestion } from './demoClauses'

// LLM assistance for the demo, in memory: no network calls. It keeps
// legal-ml-core's rules (routes/llm.py) with its default settings.

export const DEMO_LLM_MODEL = 'demo-llm'
export const DEMO_LLM_DESTINATION = 'Demo LLM (runs in this page)'
export const MONTHLY_TOKEN_CAP = 200_000
export const MAX_SYNC_TASKS = 10
export const AGREEMENT_MIN_SAMPLE = 30
export const AGREEMENT_THRESHOLD = 0.8

const DEFAULT_TEMPLATE = 'Label the legal text below with exactly one label.\n\nLabels:\n{labels}\n\nExamples:\n{examples}\n\nText to label:\n{text}'
const CONFIRMED_SOURCES = ['human', 'llm_confirmed']
const PROMPT_TOKENS = 220
const ANSWER_TOKENS = 40
const MAX_OUTPUT_TOKENS = 300

type LlmMethods = Required<Pick<MLAdapter,
  | 'getLlmStatus' | 'saveLlmKey' | 'deleteLlmKey' | 'acknowledgeLlmDestination' | 'getLlmPrompt' | 'updateLlmPrompt'
  | 'createLlmSuggestions' | 'listLlmSuggestions' | 'confirmLlmSuggestion' | 'rejectLlmSuggestion' | 'getLlmAgreement'
  | 'bulkAcceptLlmSuggestions' | 'estimateLlmAnnotation' | 'startLlmAnnotation' | 'getLlmJob'>>

/** What the LLM methods need from the demo's annotation data. */
export interface DemoAnnotationStore {
  tasks: AnnotationTask[]
  labelsOf(datasetId: Id): string[]
}

function refusal(message: string, code?: string, destination?: string): LlmRefusalError {
  const error: LlmRefusalError = new Error(message)
  if (code) error.code = code
  if (destination) error.destination = destination
  return error
}

/** Shared key until the user saves their own; the job's tick in milliseconds. */
export function createMockLlm(
  store: DemoAnnotationStore,
  delay: <T>(value: T, ms?: number) => Promise<T>,
  jobTickMs = 600,
): LlmMethods {
  let key: { base_url: string; model: string } | null = null
  let usedTokens = 0
  const acknowledged = new Map<Id, Set<string>>()
  const prompts = new Map<Id, LlmPrompt[]>()
  const suggestions: LlmSuggestion[] = []
  const jobs: Record<Id, LlmJob> = {}
  let suggestionSeq = 0
  let jobSeq = 0

  function credential() {
    return key
      ? { mode: 'byok' as const, destination: new URL(key.base_url).host, model: key.model }
      : { mode: 'shared' as const, destination: DEMO_LLM_DESTINATION, model: DEMO_LLM_MODEL }
  }

  function remaining(): number | null {
    return credential().mode === 'shared' ? Math.max(MONTHLY_TOKEN_CAP - usedTokens, 0) : null
  }

  /** Nothing is sent until this Dataset acknowledged the destination. */
  function readyCredential(datasetId: Id) {
    const cred = credential()
    if (!acknowledged.get(datasetId)?.has(cred.destination)) {
      throw refusal(`Confirm that this project's text may be sent to ${cred.destination}.`, 'acknowledgement_required', cred.destination)
    }
    return cred
  }

  function currentPrompt(datasetId: Id): LlmPrompt {
    return prompts.get(datasetId)?.at(-1) ?? { version: 0, template: DEFAULT_TEMPLATE, definitions: {} }
  }

  function taskOf(id: Id) {
    return store.tasks.find((task) => task.id === id)
  }

  /** An LLM label on a held-out item would grade the model against the LLM. */
  function pendingTasks(datasetId: Id, taskIds?: Id[]) {
    return store.tasks
      .filter((t) => t.dataset_id === datasetId && t.status === 'pending' && !t.is_holdout)
      .filter((t) => !taskIds || taskIds.includes(t.id))
      .sort((a, b) => a.item_index - b.item_index)
  }

  function inDataset(datasetId: Id) {
    return suggestions.filter((s) => taskOf(s.task_id)?.dataset_id === datasetId)
  }

  /** One suggestion per item for this model and prompt; the work done survives running out. */
  function suggestTasks(datasetId: Id, tasks: AnnotationTask[], model: string) {
    const version = currentPrompt(datasetId).version
    const labels = store.labelsOf(datasetId)
    const result = { created: [] as LlmSuggestion[], skipped: 0, invalid: 0 }
    for (const task of tasks) {
      if (suggestions.some((s) => s.task_id === task.id && s.model === model && s.prompt_version === version)) {
        result.skipped++
        continue
      }
      const left = remaining()
      if (left !== null && left <= 0) {
        throw refusal("You've reached the monthly limit. Add your own API key to continue.", 'budget_exhausted')
      }
      usedTokens += PROMPT_TOKENS + Math.ceil(task.text.length / 4) + ANSWER_TOKENS
      const { label, rationale } = demoSuggestion(task.text, labels)
      suggestionSeq++
      const suggestion: LlmSuggestion = {
        id: `sugg-${suggestionSeq}`,
        task_id: task.id,
        model,
        prompt_version: version,
        label,
        rationale,
        status: 'pending',
        created_at: new Date().toISOString(),
      }
      suggestions.push(suggestion)
      result.created.push(suggestion)
    }
    return result
  }

  function agreement(datasetId: Id): LlmAgreement {
    const latest = inDataset(datasetId).at(-1)
    const result: LlmAgreement = {
      model: latest?.model ?? null,
      prompt_version: latest?.prompt_version ?? null,
      checked: 0,
      agreed: 0,
      rate: null,
      min_sample: AGREEMENT_MIN_SAMPLE,
      threshold: AGREEMENT_THRESHOLD,
      unlocked: false,
    }
    if (!latest) return result
    const pairs = inDataset(datasetId)
      .filter((s) => s.model === latest.model && s.prompt_version === latest.prompt_version)
      .map((s) => [s.label, taskOf(s.task_id)!] as const)
      .filter(([, task]) => task.status === 'annotated' && CONFIRMED_SOURCES.includes(task.label_source ?? ''))
    result.checked = pairs.length
    result.agreed = pairs.filter(([label, task]) => label === task.annotation_label).length
    if (pairs.length) {
      result.rate = Math.round((result.agreed / pairs.length) * 10_000) / 10_000
      result.unlocked = pairs.length >= AGREEMENT_MIN_SAMPLE && result.rate >= AGREEMENT_THRESHOLD
    }
    return result
  }

  function estimate(datasetId: Id, taskIds?: Id[]) {
    const tasks = pendingTasks(datasetId, taskIds)
    const left = remaining()
    const estimated = tasks.reduce((sum, t) => sum + PROMPT_TOKENS + Math.ceil(t.text.length / 4) + MAX_OUTPUT_TOKENS, 0)
    const body: LlmEstimate = {
      tasks: tasks.length,
      estimated_tokens: estimated,
      remaining_tokens: left,
      within_budget: left === null || estimated <= left,
      destination: credential().destination,
    }
    return { tasks, estimate: body }
  }

  /** The worker: queued, then a couple of items a tick, then completed. */
  function runJob(jobId: Id, datasetId: Id, taskIds: Id[], model: string) {
    let next = 0
    const interval = setInterval(() => {
      const job = jobs[jobId]
      if (job.status === 'queued') {
        job.status = 'running'
        return
      }
      const chunk = taskIds.slice(next, next + 2).map(taskOf).filter((t): t is AnnotationTask => !!t)
      next += 2
      try {
        const done = suggestTasks(datasetId, chunk.filter((t) => t.status === 'pending'), model)
        job.created = (job.created ?? 0) + done.created.length
      } catch (err) {
        job.status = 'budget_exhausted'
        job.error = (err as Error).message
        clearInterval(interval)
        return
      }
      job.done = Math.min(next, job.total)
      if (job.done >= job.total) {
        job.status = 'completed'
        clearInterval(interval)
      }
    }, jobTickMs)
  }

  return {
    async getLlmStatus(datasetId) {
      const cred = credential()
      const status: LlmStatus = {
        mode: cred.mode,
        destination: cred.destination,
        model: cred.model,
        shared_key_allowed: true,
        key: key ? { ...key } : null,
        remaining_tokens: remaining(),
        max_sync_tasks: MAX_SYNC_TASKS,
      }
      if (datasetId) status.acknowledged = !!acknowledged.get(datasetId)?.has(cred.destination)
      return delay(status)
    },
    async saveLlmKey(input) {
      let url: URL
      try {
        url = new URL(input.base_url)
      } catch {
        throw refusal('The base URL is not a URL.', 'credential_unusable')
      }
      if (url.protocol !== 'https:') throw refusal('The base URL must use https.', 'credential_unusable')
      if (!input.model || !input.api_key) throw refusal('A model and an API key are required.')
      // The key itself is dropped: the demo never calls it.
      key = { base_url: input.base_url, model: input.model }
      return delay({ ...key })
    },
    async deleteLlmKey() {
      key = null
      return delay(undefined)
    },
    async acknowledgeLlmDestination(datasetId, destination) {
      const cred = credential()
      if (destination !== cred.destination) {
        throw refusal('The LLM destination has changed. Please review it again.', 'destination_changed', cred.destination)
      }
      if (!acknowledged.has(datasetId)) acknowledged.set(datasetId, new Set())
      acknowledged.get(datasetId)!.add(destination)
      return delay({ destination, created_at: new Date().toISOString() })
    },
    async getLlmPrompt(datasetId) {
      return delay({ ...currentPrompt(datasetId) })
    },
    async updateLlmPrompt(datasetId, edit) {
      const template = edit.template.trim()
      if (!template) throw refusal("The prompt can't be empty.", 'prompt_rejected')
      for (const slot of ['{labels}', '{text}']) {
        if (template.split(slot).length !== 2) throw refusal(`The prompt must contain ${slot} exactly once.`, 'prompt_rejected')
      }
      const labels = store.labelsOf(datasetId)
      const unknown = Object.keys(edit.definitions).find((label) => !labels.includes(label))
      if (unknown) throw refusal(`'${unknown}' is not one of this dataset's labels.`, 'prompt_rejected')
      const saved: LlmPrompt = {
        version: currentPrompt(datasetId).version + 1,
        template,
        definitions: { ...edit.definitions },
        created_at: new Date().toISOString(),
      }
      prompts.set(datasetId, [...(prompts.get(datasetId) ?? []), saved])
      return delay({ ...saved })
    },
    async createLlmSuggestions(datasetId, taskIds) {
      if (!taskIds.length) throw refusal('task_ids is required.')
      if (taskIds.length > MAX_SYNC_TASKS) throw refusal(`Send at most ${MAX_SYNC_TASKS} task ids. Use annotate for more.`)
      const cred = readyCredential(datasetId)
      const result = suggestTasks(datasetId, pendingTasks(datasetId, taskIds), cred.model)
      const batch: LlmSuggestionBatch = { suggestions: result.created.map((s) => ({ ...s })), skipped: result.skipped, invalid: result.invalid }
      return delay(batch, 700)
    },
    async listLlmSuggestions(datasetId, status) {
      return delay(
        inDataset(datasetId)
          .filter((s) => !taskOf(s.task_id)?.is_holdout && (!status || s.status === status))
          .map((s) => ({ ...s })),
      )
    },
    async confirmLlmSuggestion(suggestionId, label) {
      const suggestion = suggestions.find((s) => s.id === suggestionId)
      if (!suggestion) throw refusal('Suggestion not found')
      const task = taskOf(suggestion.task_id)!
      if (task.is_holdout) throw refusal("This item is held back to check the Model, so it can't take a suggestion.")
      const chosen = label ?? suggestion.label
      if (!store.labelsOf(task.dataset_id).includes(chosen)) throw refusal("That label isn't one of this dataset's labels.")
      const corrected = chosen !== suggestion.label
      suggestion.status = corrected ? 'corrected' : 'accepted'
      task.annotation_label = chosen
      task.status = 'annotated'
      task.label_source = corrected ? 'human' : 'llm_confirmed'
      task.updated_at = new Date().toISOString()
      return delay({ suggestion: { ...suggestion }, task: { ...task } })
    },
    async rejectLlmSuggestion(suggestionId) {
      const suggestion = suggestions.find((s) => s.id === suggestionId)
      if (!suggestion) throw refusal('Suggestion not found')
      suggestion.status = 'rejected'
      return delay({ ...suggestion })
    },
    async getLlmAgreement(datasetId) {
      return delay(agreement(datasetId))
    },
    async bulkAcceptLlmSuggestions(datasetId) {
      const check = agreement(datasetId)
      if (!check.unlocked) {
        throw refusal(
          `Bulk accept needs ${check.min_sample} checked items at ${Math.round(check.threshold * 100)}% agreement.`,
          'agreement_not_met',
        )
      }
      const now = new Date().toISOString()
      const accepted = inDataset(datasetId).filter((s) => {
        const task = taskOf(s.task_id)!
        return s.status === 'pending' && task.status === 'pending' && !task.is_holdout
          && s.model === check.model && s.prompt_version === check.prompt_version
      })
      for (const s of accepted) {
        const task = taskOf(s.task_id)!
        s.status = 'bulk_accepted'
        task.annotation_label = s.label
        task.status = 'annotated'
        task.label_source = 'llm_bulk'
        task.updated_at = now
      }
      return delay({ accepted: accepted.length, agreement: check })
    },
    async estimateLlmAnnotation(datasetId, taskIds) {
      return delay(estimate(datasetId, taskIds).estimate)
    },
    async startLlmAnnotation(datasetId, taskIds) {
      const cred = readyCredential(datasetId)
      const { tasks, estimate: body } = estimate(datasetId, taskIds)
      if (!tasks.length) throw refusal('There are no pending items to annotate.')
      if (!body.within_budget) throw refusal('This job is larger than your remaining monthly limit.', 'budget_exhausted')
      jobSeq++
      const jobId = `llm-job-${jobSeq}`
      jobs[jobId] = { status: 'queued', total: tasks.length, done: 0, created: 0, invalid: 0 }
      runJob(jobId, datasetId, tasks.map((t) => t.id), cred.model)
      return delay({ job_id: jobId, estimate: body })
    },
    async getLlmJob(jobId) {
      const job = jobs[jobId]
      if (!job) throw refusal('Job not found')
      return delay({ ...job })
    },
  }
}
