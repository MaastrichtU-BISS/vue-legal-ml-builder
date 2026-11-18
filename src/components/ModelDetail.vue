<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { MLAdapter, MlModel, PredictionResult } from '../types'
import { scoreRows } from '../utils/metrics'
import { modelTypeLabel } from './modelCatalogData'
import ConfusionMatrix from './shared/ConfusionMatrix.vue'
import PlotlyChart from './shared/PlotlyChart.vue'
import Icon from './shared/Icon.vue'

const props = defineProps<{ adapter?: MLAdapter; modelId: string }>()
const emit = defineEmits<{ train: [] }>()

const injectedAdapter = inject<MLAdapter | null>('vmlb:adapter', null)
const adapter = computed(() => props.adapter ?? injectedAdapter)

const model = ref<MlModel | null>(null)
const performanceChart = ref<string | null>(null)
const isLoading = ref(true)
const error = ref('')

const predictText = ref('')
const predictResults = ref<PredictionResult[]>([])
const isPredicting = ref(false)

// Classification reports accuracy, NER reports F1, and summarization reports
// ROUGE; whichever the model has are shown, never a blank or NaN.
const SCORE_KEYS = ['accuracy', 'precision', 'recall', 'f1_score', 'rouge1', 'rouge2', 'rougeL']
const scores = computed(() => scoreRows(model.value?.metrics, SCORE_KEYS))

const isEntityModel = computed(() => ['legalbert_ner', 'distilbert_ner'].includes(model.value?.model_type ?? ''))
const isSummarizationModel = computed(() => model.value?.model_type === 't5_small')
// The performance endpoint fills missing classification metrics with zero, so
// its chart would read a false 0% for entity and summarization models.
const hasLegacyChart = (modelType: string) => !['legalbert_ner', 'distilbert_ner', 't5_small'].includes(modelType)

const classificationReport = computed(() => {
  const value = model.value?.metrics?.classification_report
  return typeof value === 'string' && value.trim() ? value : null
})

const predictPlaceholder = computed(() => {
  if (isEntityModel.value) return 'Paste text to find entities in…'
  if (isSummarizationModel.value) return 'Paste a document to summarise…'
  return 'Paste a clause to classify…'
})

onMounted(async () => {
  if (!adapter.value) {
    error.value = 'No adapter configured'
    isLoading.value = false
    return
  }
  try {
    model.value = await adapter.value.getModel(props.modelId)
    if (model.value.status === 'completed' && hasLegacyChart(model.value.model_type)) {
      try {
        const perf = await adapter.value.getModelPerformance(props.modelId)
        performanceChart.value = perf.performance_chart
      } catch {
        // performance chart is best-effort — model may not have Redis-cached metrics
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load model'
  } finally {
    isLoading.value = false
  }
})

async function runPredict() {
  if (!adapter.value || !model.value || !predictText.value.trim()) return
  isPredicting.value = true
  try {
    predictResults.value = await adapter.value.predict(model.value.id, [predictText.value])
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Prediction failed'
  } finally {
    isPredicting.value = false
  }
}
</script>

<template>
  <div class="vmlb-detail">
    <div v-if="error" class="vmlb-alert-error">
      <Icon name="alert" /> {{ error }}
    </div>

    <div v-if="isLoading" class="vmlb-detail-skeleton">
      <div class="vmlb-skeleton vmlb-skeleton-line" style="width: 40%" />
      <div class="vmlb-skeleton vmlb-skeleton-chart" />
    </div>

    <template v-else-if="model">
      <header class="vmlb-header">
        <div>
          <h2 class="vmlb-display">{{ model.name }}</h2>
          <p class="vmlb-muted">{{ modelTypeLabel(model.model_type) }} · {{ model.status }}</p>
        </div>
        <button v-if="model.status === 'pending'" class="vmlb-btn-primary" @click="emit('train')">
          <Icon name="play" /> Train
        </button>
      </header>

      <div v-if="model.status === 'completed'">
        <div v-if="performanceChart && hasLegacyChart(model.model_type)" class="vmlb-card">
          <PlotlyChart :plot-data="performanceChart" plot-id="vmlb-model-performance" />
        </div>

        <div v-if="scores.length" class="vmlb-card">
          <h3 class="vmlb-card-title">Scores</h3>
          <div class="vmlb-detail-scores">
            <div v-for="score in scores" :key="score.key" class="vmlb-row">
              <span class="vmlb-muted">{{ score.label }}</span>
              <span class="vmlb-num">{{ score.text }}</span>
            </div>
          </div>
        </div>

        <div v-if="classificationReport" class="vmlb-card">
          <h3 class="vmlb-card-title">Classification report</h3>
          <pre class="vmlb-report">{{ classificationReport }}</pre>
        </div>

        <div v-if="(model.metrics as any)?.confusion_matrix" class="vmlb-card">
          <ConfusionMatrix
            :matrix="(model.metrics as any).confusion_matrix"
            :labels="(model.metrics as any).confusion_matrix_labels ?? null"
            :classification-report="classificationReport"
          />
        </div>

        <div class="vmlb-card">
          <h3 class="vmlb-card-title">Try a prediction</h3>
          <textarea v-model="predictText" rows="3" :placeholder="predictPlaceholder" />
          <button class="vmlb-btn-primary" :disabled="isPredicting || !predictText.trim()" @click="runPredict">
            {{ isPredicting ? 'Predicting…' : 'Predict' }}
          </button>

          <div v-if="predictResults.length" class="vmlb-predictions">
            <div v-for="(r, i) in predictResults" :key="i" class="vmlb-prediction">
              <template v-if="isEntityModel">
                <div v-if="r.entities?.length" class="vmlb-entities">
                  <span v-for="(entity, j) in r.entities" :key="j" class="vmlb-entity-chip">
                    <span class="vmlb-entity-text">{{ entity.text }}</span>
                    <span class="vmlb-entity-type">{{ entity.type }}</span>
                  </span>
                </div>
                <p v-else-if="r.entities" class="vmlb-muted">No entities found</p>
                <strong v-else>{{ r.prediction }}</strong>
              </template>
              <p v-else-if="isSummarizationModel" class="vmlb-summary">{{ r.prediction }}</p>
              <template v-else>
                <strong>{{ r.prediction }}</strong>
                <span v-if="r.confidence !== undefined" class="vmlb-muted vmlb-num">
                  {{ (r.confidence * 100).toFixed(1) }}% confidence
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="vmlb-card">
        <p class="vmlb-muted vmlb-capitalize">
          This model is {{ model.status }}. Train it to see performance and run predictions.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vmlb-detail { max-width: 62rem; margin: 0 auto; }
.vmlb-detail-skeleton { display: flex; flex-direction: column; gap: 1.25rem; }
.vmlb-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1.75rem; }
.vmlb-header h2 { margin: 0 0 0.25rem; font-size: var(--vmlb-font-size-3xl); }
.vmlb-header .vmlb-muted { margin: 0; }
.vmlb-card { margin-bottom: 1.25rem; }
.vmlb-card-title { margin-top: 0; }
.vmlb-detail-scores { max-width: 24rem; }
.vmlb-card .vmlb-card-title + textarea,
.vmlb-card textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--vmlb-border-strong); border-radius: var(--vmlb-radius-md);
  padding: 0.6rem 0.75rem; font-family: inherit; font-size: var(--vmlb-font-size-md);
  background: var(--vmlb-surface); color: var(--vmlb-text);
  margin-bottom: 0.75rem; resize: vertical;
}
.vmlb-card textarea:focus { outline: none; border-color: var(--vmlb-accent); box-shadow: 0 0 0 3px var(--vmlb-accent-soft); }
.vmlb-report {
  margin: 0; padding: 0.75rem 1rem; overflow-x: auto;
  background: var(--vmlb-surface-sunken); border-radius: var(--vmlb-radius-sm);
  font-family: var(--vmlb-font-mono, monospace); font-size: var(--vmlb-font-size-xs);
  color: var(--vmlb-text); white-space: pre;
}
.vmlb-predictions { margin-top: 1rem; border-top: 1px solid var(--vmlb-border); padding-top: 1rem; }
.vmlb-prediction { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: 0.375rem 0; }
.vmlb-entities { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.vmlb-entity-chip {
  display: inline-flex; align-items: baseline; gap: 0.35rem;
  padding: 0.125rem 0.5rem; border-radius: var(--vmlb-radius-sm);
  background: var(--vmlb-accent-soft); color: var(--vmlb-text);
  font-size: var(--vmlb-font-size-sm);
}
.vmlb-entity-type {
  font-size: var(--vmlb-font-size-2xs); font-weight: 600;
  letter-spacing: var(--vmlb-label-tracking); text-transform: var(--vmlb-label-case);
  color: var(--vmlb-accent-strong);
}
.vmlb-summary { margin: 0; line-height: 1.55; white-space: pre-wrap; }
.vmlb-capitalize { text-transform: capitalize; }
</style>
