<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useSummarization, type SummaryInput } from '../../composables/useSummarization'
import type { MLAdapter, SummaryDocument, SummaryLength, SummaryPriority, SummaryResult } from '../../types'
import Icon from '../shared/Icon.vue'
import SummaryControls from './SummaryControls.vue'
import SummaryDisplay from './SummaryDisplay.vue'
import SummaryInputPanel from './SummaryInputPanel.vue'
import SummaryProgress from './SummaryProgress.vue'

const props = defineProps<{
  adapter?: MLAdapter
  title?: string
  subtitle?: string
  /** Fills the paste tab. */
  initialText?: string
  /** Offered in the "Select documents" tab. */
  documents?: SummaryDocument[]
  /** Shows "Save summary" on each result; the host persists it on `save`. */
  allowSave?: boolean
  /** Milliseconds between polls. Default: the plugin's `pollInterval`, else 1500. */
  pollInterval?: number
}>()

const emit = defineEmits<{ save: [result: SummaryResult] }>()

const injectedAdapter = inject<MLAdapter | null>('vmlb:adapter', null)
const injectedPoll = inject<number | null>('vmlb:pollInterval', null)
const adapter = (props.adapter ?? injectedAdapter ?? {}) as MLAdapter

const {
  available, isLoading, error, results, status, overallProgress, batchCompleted, batchTotal,
  models, modelsError, summarize, reset, loadModels,
} = useSummarization(adapter, props.pollInterval ?? injectedPoll ?? 1500)

onMounted(loadModels)

const inputs = ref<SummaryInput[]>([])
const summaryLength = ref<SummaryLength>('medium')
const priority = ref<SummaryPriority>({ relevance: 0.5, readability: 0.5 })
const model = ref<string | undefined>(undefined)
const canSubmit = computed(() => inputs.value.length > 0 && !isLoading.value)
const submitLabel = computed(() => (inputs.value.length > 1 ? `Summarise ${inputs.value.length} documents` : 'Summarise'))

function submit() {
  if (!canSubmit.value) return
  void summarize(inputs.value, { summaryLength: summaryLength.value, priority: priority.value, model: model.value })
}
</script>

<template>
  <section class="vmlb-summarize">
    <header v-if="title || subtitle" class="vmlb-summarize-head">
      <h2 v-if="title" class="vmlb-display">{{ title }}</h2>
      <p v-if="subtitle" class="vmlb-muted">{{ subtitle }}</p>
    </header>

    <div v-if="!available" class="vmlb-card vmlb-empty">
      <p class="vmlb-empty-title">Summarisation is not available</p>
      <p>This backend does not offer summaries.</p>
    </div>

    <template v-else>
      <div class="vmlb-card">
        <SummaryInputPanel :initial-text="initialText" :documents="documents" @update:inputs="inputs = $event" />
        <SummaryControls
          :models="models"
          :models-error="modelsError"
          @update:summary-length="summaryLength = $event"
          @update:priority="priority = $event"
          @update:model="model = $event"
        />
        <SummaryProgress
          v-if="isLoading"
          :progress="overallProgress"
          :status="status"
          :batch-completed="batchCompleted"
          :batch-total="batchTotal"
        />
        <div class="vmlb-actions">
          <button v-if="isLoading || results.length || error" type="button" class="vmlb-btn-secondary" @click="reset">
            {{ isLoading ? 'Cancel' : 'Clear' }}
          </button>
          <button type="button" class="vmlb-btn-primary" :disabled="!canSubmit" @click="submit">
            {{ isLoading ? 'Summarising…' : submitLabel }}
          </button>
        </div>
      </div>

      <div v-if="error" class="vmlb-alert-error vmlb-summarize-error" role="alert"><Icon name="alert" /> {{ error }}</div>

      <SummaryDisplay :results="results" :allow-save="allowSave" @save="emit('save', $event)" />
    </template>
  </section>
</template>

<style scoped>
.vmlb-summarize { max-width: 62rem; margin: 0 auto; }
.vmlb-summarize-head { margin-bottom: 1.5rem; }
.vmlb-summarize-head h2 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.vmlb-summarize-head .vmlb-muted { margin: 0; max-width: 60ch; }
.vmlb-summarize-error { margin: var(--vmlb-space-md) 0 0; }
</style>
