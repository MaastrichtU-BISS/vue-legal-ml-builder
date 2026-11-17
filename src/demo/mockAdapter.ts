import type {
  AnnotationAssignment,
  AnnotationTask,
  Dataset,
  Id,
  MLAdapter,
  MlModel,
  ModelCatalog,
  SummarizationError,
  SummarizationJob,
  SummarizationModels,
  SummaryLength,
  TrainingJob,
  TrainingMetricPoint,
} from '../types'
import { AVAILABLE_MODELS_DEMO } from './demoCatalog'
import { CLAUSE_LABELS, LEASE_CLAUSES } from './demoClauses'
import { createMockLlm } from './mockLlm'

/** The Dataset the demo's annotate view opens. */
export const DEMO_ANNOTATION_DATASET = 'ds-2'

let datasetSeq = 0
let modelSeq = 0
let jobSeq = 0

const datasets: Dataset[] = [
  {
    id: 'ds-1',
    user_id: 'demo-user',
    name: 'Sample Legal Contracts',
    description: 'A demo dataset of contract clauses',
    file_path: '/tmp/demo.csv',
    row_count: 240,
    columns: [{ name: 'text', type: 'object', null_count: 0, unique_count: 240 }, { name: 'label', type: 'object', null_count: 0, unique_count: 2 }],
    task_type: 'classification',
    dataset_type: 'training',
    annotation_progress: 100,
    annotated_count: 240,
    total_count: 240,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: DEMO_ANNOTATION_DATASET,
    user_id: 'demo-user',
    name: 'Lease clauses',
    description: 'Clauses to label as an obligation, a permission or a prohibition',
    file_path: '/tmp/lease-clauses.csv',
    row_count: LEASE_CLAUSES.length,
    columns: [{ name: 'text', type: 'object', null_count: 0, unique_count: LEASE_CLAUSES.length }],
    task_type: 'classification',
    dataset_type: 'unlabeled',
    annotation_progress: 0,
    annotated_count: 0,
    total_count: LEASE_CLAUSES.length,
    text_column: 'text',
    labels: CLAUSE_LABELS,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

const seedAt = new Date().toISOString()
const models: MlModel[] = [
  {
    id: 'seed-svm-1',
    user_id: 'demo-user',
    dataset_id: 'ds-1',
    project_id: null,
    name: 'SVM C=0.1 (linear)',
    model_type: 'svm',
    parameters: { C: 0.1, kernel: 'linear' },
    status: 'completed',
    metrics: { accuracy: 0.84, precision: 0.83, recall: 0.84, f1_score: 0.83 },
    created_at: seedAt,
    updated_at: seedAt,
  },
  {
    id: 'seed-svm-2',
    user_id: 'demo-user',
    dataset_id: 'ds-1',
    project_id: null,
    name: 'SVM C=1.0 (rbf)',
    model_type: 'svm',
    parameters: { C: 1.0, kernel: 'rbf' },
    status: 'completed',
    metrics: { accuracy: 0.91, precision: 0.9, recall: 0.91, f1_score: 0.9 },
    created_at: seedAt,
    updated_at: seedAt,
  },
  {
    id: 'seed-svm-3',
    user_id: 'demo-user',
    dataset_id: 'ds-1',
    project_id: null,
    name: 'SVM C=10 (rbf)',
    model_type: 'svm',
    parameters: { C: 10, kernel: 'rbf' },
    status: 'completed',
    metrics: { accuracy: 0.88, precision: 0.87, recall: 0.88, f1_score: 0.87 },
    created_at: seedAt,
    updated_at: seedAt,
  },
]
const jobs: Record<string, TrainingJob> = {}
const summaries: Record<string, { job: SummarizationJob; polls: number; text: string }> = {}
let summarySeq = 0
const metricPoints: Record<string, TrainingMetricPoint[]> = {}

function delay<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** The annotate view's items, one per lease clause, all pending. */
function demoTasks(): AnnotationTask[] {
  const at = new Date().toISOString()
  return LEASE_CLAUSES.map((text, index) => ({
    id: `task-${index + 1}`,
    dataset_id: DEMO_ANNOTATION_DATASET,
    item_index: index,
    text,
    annotation_label: null,
    status: 'pending' as const,
    label_source: null,
    is_holdout: false,
    created_at: at,
    updated_at: at,
  }))
}

export function createMockAdapter(): MLAdapter {
  // Each adapter has its own items and LLM state, so tests start clean.
  const tasks = demoTasks()
  const labelsOf = (datasetId: Id) => datasets.find((d) => d.id === datasetId)?.labels ?? []
  const taskOf = (id: Id) => {
    const task = tasks.find((t) => t.id === id)
    if (!task) throw new Error('Task not found')
    return task
  }
  const tasksOf = (datasetId?: Id) => tasks.filter((t) => !datasetId || t.dataset_id === datasetId)
  /** A Dataset with its annotation counts as they are now. */
  const withProgress = (ds: Dataset): Dataset => {
    const items = tasksOf(ds.id)
    if (!items.length) return ds
    const annotated = items.filter((t) => t.status === 'annotated').length
    return { ...ds, annotated_count: annotated, annotation_progress: Math.round((annotated / items.length) * 100) }
  }
  const label = (task: AnnotationTask, value: string, source: string) => {
    task.annotation_label = value
    task.status = 'annotated'
    task.label_source = source
    task.updated_at = new Date().toISOString()
    return { ...task }
  }

  return {
    async listDatasets() {
      return delay(datasets.map(withProgress))
    },
    async getDataset(id) {
      const ds = datasets.find((d) => d.id === id)
      if (!ds) throw new Error('Dataset not found')
      return delay(withProgress(ds))
    },
    async uploadDataset(file, meta) {
      datasetSeq++
      const ds: Dataset = {
        id: `ds-${datasetSeq}`,
        user_id: 'demo-user',
        name: meta.name,
        description: meta.description ?? null,
        file_path: `/tmp/${file.name}`,
        row_count: 100,
        columns: [],
        task_type: meta.task_type,
        dataset_type: 'training',
        annotation_progress: 0,
        annotated_count: 0,
        total_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      datasets.unshift(ds)
      return delay(ds)
    },
    async deleteDataset(id) {
      const idx = datasets.findIndex((d) => d.id === id)
      if (idx >= 0) datasets.splice(idx, 1)
      return delay(undefined)
    },
    async getEdaData() {
      return delay({
        dataset_overview: { shape: { rows: 240, columns: 2 } },
        column_analysis: {
          text: { dtype: 'object', null_count: 0, null_percentage: 0, unique_count: 240, unique_percentage: 100 },
          label: { dtype: 'object', null_count: 0, null_percentage: 0, unique_count: 2, unique_percentage: 0.8 },
        },
        data_quality: { issues: [], overall_quality_score: 96 },
        statistical_summary: { numeric_summary: {}, categorical_summary: {} },
        task_specific_analysis: { label_distribution: { positive: 120, negative: 120 } },
        insights: [{ type: 'info', title: 'Balanced classes', message: 'Label distribution is balanced.', priority: 'low' }],
      })
    },

    async listModels(datasetId) {
      return delay(datasetId ? models.filter((m) => m.dataset_id === datasetId) : [...models])
    },
    async getModel(id) {
      const m = models.find((x) => x.id === id)
      if (!m) throw new Error('Model not found')
      return delay(m)
    },
    async getAvailableModelTypes(taskType) {
      const catalog: ModelCatalog = AVAILABLE_MODELS_DEMO
      return delay(taskType ? { [taskType]: catalog[taskType] } : catalog)
    },
    async createModel(config) {
      modelSeq++
      const model: MlModel = {
        id: `model-${modelSeq}`,
        user_id: 'demo-user',
        dataset_id: config.dataset_id,
        project_id: config.project_id ?? null,
        name: config.name,
        model_type: config.model_type,
        parameters: config.parameters,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      models.unshift(model)
      return delay(model)
    },
    async updateModel(id, changes) {
      const m = models.find((x) => x.id === id)
      if (!m) throw new Error('Model not found')
      if (changes.name !== undefined) m.name = changes.name.trim()
      if (changes.parameters) m.parameters = changes.parameters
      m.updated_at = new Date().toISOString()
      return delay(m)
    },
    async deleteModel(id) {
      const idx = models.findIndex((m) => m.id === id)
      if (idx >= 0) models.splice(idx, 1)
      return delay(undefined)
    },

    async startTraining(modelId) {
      jobSeq++
      const jobId = `job-${jobSeq}`
      const model = models.find((m) => m.id === modelId)
      if (model) model.status = 'training'
      jobs[jobId] = { id: jobId, user_id: 'demo-user', model_id: modelId, status: 'running', progress: 0, created_at: new Date().toISOString() }
      metricPoints[jobId] = []
      simulateTraining(jobId, modelId)
      return delay({ job_id: jobId })
    },
    async getTrainingStatus(jobId) {
      const job = jobs[jobId]
      const model = job ? models.find((m) => m.id === job.model_id) ?? null : null
      return delay({ job, model })
    },
    async stopTraining(jobId) {
      if (jobs[jobId]) jobs[jobId].status = 'cancelled'
      return delay(undefined)
    },
    async getTrainingMetrics(jobId, sinceStep = -1) {
      const points = metricPoints[jobId] ?? []
      return delay(points.filter((p) => p.step > sinceStep))
    },

    async predict(_modelId, texts) {
      return delay(texts.map((t) => ({ text: t, prediction: Math.random() > 0.5 ? 'positive' : 'negative', confidence: 0.7 + Math.random() * 0.3 })))
    },
    async explain() {
      return delay({ predicted_class: 'positive', type: 'lime_text', features: [{ feature: 'contract', weight: 0.42 }] })
    },

    async getModelPerformance() {
      return delay({
        performance_data: { accuracy: 0.91, precision: 0.89, recall: 0.9, f1_score: 0.895 },
        performance_chart: JSON.stringify({
          data: [
            {
              type: 'bar',
              x: ['accuracy', 'precision', 'recall', 'f1_score'],
              y: [0.91, 0.89, 0.9, 0.895],
            },
          ],
          layout: { title: 'Model performance', height: 360, yaxis: { range: [0, 1] } },
        }),
      })
    },
    async getConfusionMatrix() {
      return delay({ confusion_matrix: [[42, 3], [5, 38]], labels: ['positive', 'negative'] })
    },
    async compareModels(modelIds, name) {
      return delay({ id: 'cmp-1', user_id: 'demo-user', name, model_ids: modelIds, comparison_metrics: { metrics: [], chart: '' }, created_at: new Date().toISOString() })
    },
    async getParameterComparison(modelType, metric) {
      return delay(
        models
          .filter((m) => m.model_type === modelType && m.metrics)
          .map((m) => ({ model_id: m.id, training_job_id: `job-for-${m.id}`, parameters: m.parameters, metric_value: (m.metrics as any)?.[metric] ?? 0 })),
      )
    },

    async getNextAnnotationTask(_projectId, datasetId, options) {
      const items = tasksOf(datasetId)
      const holdout = !!options?.holdout
      const next = items
        .filter((t) => t.status === 'pending' && !!t.is_holdout === holdout)
        .sort((a, b) => a.item_index - b.item_index)[0]
      const annotated = items.filter((t) => t.status === 'annotated').length
      const stats = {
        total: items.length,
        annotated,
        percentage: items.length ? Math.round((annotated / items.length) * 100) : 0,
        holdout_remaining: items.filter((t) => t.is_holdout && t.status === 'pending').length,
      }
      return delay({ task: next ? { ...next } : null, stats })
    },
    async listAnnotationTasks(_projectId, filter) {
      return delay(
        tasksOf(filter.datasetId)
          .filter((t) => !filter.status || t.status === filter.status)
          .map((t) => ({ ...t })),
      )
    },
    async saveAnnotation(taskId, value) {
      return delay(label(taskOf(taskId), String(value), 'human'))
    },
    async skipAnnotation(taskId) {
      const task = taskOf(taskId)
      task.status = 'skipped'
      task.updated_at = new Date().toISOString()
      return delay({ ...task })
    },
    async getAnnotationAssignment(taskId) {
      const task = taskOf(taskId)
      const opened: AnnotationAssignment = {
        document: { name: `Lease clauses, item ${task.item_index + 1}`, full_text: task.text },
        assignment: {
          id: taskId, annotator: 'demo', order: task.item_index + 1, status: task.status === 'annotated' ? 'done' : 'pending', confidence: 0,
          annotations: [],
          document_annotations: task.annotation_label ? [{ id: 1, label: task.annotation_label, confidence: 0 }] : [],
          document_relations: [],
        },
        labels: labelsOf(task.dataset_id),
        annotationLevel: task.status === 'annotated' ? 'document' : null,
        labelSource: task.label_source ?? null,
        fileLabel: null,
        hint: null,
      }
      return delay(opened)
    },
    async saveAnnotationAssignment(taskId, assignment) {
      const value = assignment.document_annotations[0]?.label
      if (!value) throw new Error('Choose a label for this item.')
      return delay(label(taskOf(taskId), value, 'human'))
    },

    // LLM assistance: a keyword rule stands in for the model.
    ...createMockLlm({ tasks, labelsOf }, delay),

    // Summarization: queued, then processing, then complete over three polls.
    async summarize(request) {
      if (!request.input_text?.trim()) throw refuse(400, 'input_text is required.')
      summarySeq++
      const requestId = request.request_id ?? `sum-${summarySeq}`
      const job: SummarizationJob = { request_id: requestId, status: 'queued', progress: 0, summarized_text: null, error: null }
      summaries[requestId] = { job, polls: 0, text: extractSummary(request.input_text, request.summary_length ?? 'medium') }
      return delay({ ...job })
    },
    async getSummarizationJob(requestId) {
      const entry = summaries[requestId]
      if (!entry) throw refuse(404, 'Summarization request not found.')
      entry.polls++
      entry.job =
        entry.polls >= 3
          ? { ...entry.job, status: 'complete', progress: 100, summarized_text: entry.text }
          : { ...entry.job, status: 'processing', progress: entry.polls * 40 }
      return delay({ ...entry.job })
    },
    async getSummarizationModels() {
      return delay(SUMMARIZATION_MODELS_DEMO)
    },
  }
}

function refuse(status: number, message: string): SummarizationError {
  const error: SummarizationError = new Error(message)
  error.status = status
  return error
}

const SUMMARIZATION_MODELS_DEMO: SummarizationModels = {
  default: 'lex_rank',
  abstractive_available: false,
  extractive: [
    { id: 'lex_rank', label: 'LexRank', description: 'Picks the sentences most similar to the rest of the text.' },
    { id: 'lsa', label: 'LSA', description: 'Picks the sentences that best cover the main topics.' },
    { id: 'text_rank', label: 'TextRank', description: 'Ranks sentences by how they link to each other.' },
    { id: 'luhn', label: 'Luhn', description: 'Picks the sentences with the most frequent important words.' },
    { id: 'edmundson', label: 'Edmundson', description: 'Weighs cue words, title words and sentence position.' },
  ],
  abstractive: [
    { id: 'hf:facebook/bart-large-cnn', label: 'BART large CNN', description: 'Writes a new summary in English.' },
    { id: 'hf:sshleifer/distilbart-cnn-12-6', label: 'DistilBART CNN', description: 'A smaller, faster BART.' },
    { id: 'hf:yhavinga/ul2-large-dutch', label: 'UL2 large Dutch', description: 'Writes a new summary in Dutch.' },
  ],
}

/** An extractive stand-in: the first sentences, as many as the length asks for. */
function extractSummary(text: string, length: SummaryLength): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/)
  if (typeof length === 'number') {
    const words = text.trim().split(/\s+/)
    return words.slice(0, Math.max(1, length)).join(' ')
  }
  const count = { short: 1, medium: 2, long: 4 }[length]
  return sentences.slice(0, count).join(' ')
}

type DemoPoint = Pick<TrainingMetricPoint, 'metric_name' | 'group' | 'value' | 'epoch' | 'training_step'>

const stage = (metric_name: string): DemoPoint => ({ metric_name, group: 'stage', value: 1, epoch: null, training_step: null })

/** A short fine-tuning run: stages, a falling loss every 10 steps and an
 * evaluation after each of the two epochs. Each entry is one tick. */
function demoRun(): Array<{ points: DemoPoint[]; progress: number }> {
  const ticks: Array<{ points: DemoPoint[]; progress: number }> = [
    { points: [stage('preprocessing_started')], progress: 0 },
    { points: [stage('preprocessing_done'), stage('training_started')], progress: 25 },
  ]
  const stepsPerEpoch = 40
  for (let step = 10; step <= stepsPerEpoch * 2; step += 10) {
    const epoch = step / stepsPerEpoch
    const points: DemoPoint[] = [
      { metric_name: 'loss', group: 'train', value: 0.7 * Math.exp(-step / 60) + 0.1, epoch, training_step: step },
      { metric_name: 'learning_rate', group: 'train', value: 2e-5 * (1 - step / (stepsPerEpoch * 2)), epoch, training_step: step },
    ]
    if (step % stepsPerEpoch === 0) {
      points.push(
        { metric_name: 'eval_loss', group: 'eval', value: 0.5 - epoch * 0.1, epoch, training_step: step },
        { metric_name: 'eval_accuracy', group: 'eval', value: 0.8 + epoch * 0.05, epoch, training_step: step },
      )
    }
    ticks.push({ points, progress: 25 + Math.round((50 * step) / (stepsPerEpoch * 2)) })
  }
  ticks.push({ points: [stage('training_done')], progress: 75 }, { points: [stage('model_saved')], progress: 100 })
  return ticks
}

function simulateTraining(jobId: string, modelId: string) {
  const ticks = demoRun()
  let i = 0
  const interval = setInterval(() => {
    if (i >= ticks.length) {
      clearInterval(interval)
      const job = jobs[jobId]
      const model = models.find((m) => m.id === modelId)
      if (job) job.status = 'completed'
      if (model) {
        model.status = 'completed'
        model.metrics = { accuracy: 0.91, precision: 0.89, recall: 0.9, f1_score: 0.895, confusion_matrix: [[42, 3], [5, 38]], confusion_matrix_labels: ['positive', 'negative'] }
      }
      return
    }
    const series = metricPoints[jobId]
    for (const p of ticks[i].points) {
      const step = series.length
      series.push({ id: `pt-${jobId}-${step}`, training_job_id: jobId, step, created_at: new Date().toISOString(), ...p })
    }
    if (jobs[jobId]) jobs[jobId].progress = ticks[i].progress
    i++
  }, 1200)
}
