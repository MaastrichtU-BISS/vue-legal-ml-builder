<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { defaultSummaryModel, summaryModelChoices } from '../../summarization/summaryDisplay'
import type { SummarizationModels, SummaryLength, SummaryPriority } from '../../types'

const props = defineProps<{
  /** The server's models. The picker is hidden until they load. */
  models?: SummarizationModels | null
  /** Why the models could not be loaded; the server's default is then used. */
  modelsError?: string | null
}>()

const emit = defineEmits<{
  'update:summaryLength': [value: SummaryLength]
  'update:priority': [value: SummaryPriority]
  /** Undefined leaves the model to the server. */
  'update:model': [value: string | undefined]
}>()

// Ids unique per instance, so two widgets on a page keep their labels apart.
const uid = `vmlb-sum-${Math.random().toString(36).slice(2, 9)}`

type LengthPreset = 'short' | 'medium' | 'long' | 'custom'
const LENGTHS: Array<{ id: LengthPreset; label: string }> = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
  { id: 'custom', label: 'Words' },
]
const lengthPreset = ref<LengthPreset>('medium')
const wordCount = ref(150)

watch([lengthPreset, wordCount], () => {
  emit('update:summaryLength', lengthPreset.value === 'custom' ? wordCount.value : lengthPreset.value)
}, { immediate: true })

const relevance = ref(0.5)
const readability = ref(0.5)

watch([relevance, readability], () => {
  emit('update:priority', { relevance: relevance.value, readability: readability.value })
}, { immediate: true })

const choices = computed(() => summaryModelChoices(props.models ?? null))
const extractive = computed(() => choices.value.filter((c) => c.kind === 'extractive'))
const abstractive = computed(() => choices.value.filter((c) => c.kind === 'abstractive'))
const selectedModel = ref<string | undefined>(defaultSummaryModel(props.models ?? null))
const selectedChoice = computed(() => choices.value.find((c) => c.id === selectedModel.value))

watch(() => props.models, (models) => {
  selectedModel.value = defaultSummaryModel(models ?? null)
})
watch(selectedModel, (v) => emit('update:model', v), { immediate: true })
</script>

<template>
  <div class="vmlb-sum-controls">
    <fieldset class="vmlb-sum-fieldset">
      <legend class="vmlb-label">Length</legend>
      <div class="vmlb-sum-segmented">
        <label v-for="opt in LENGTHS" :key="opt.id" :class="{ active: lengthPreset === opt.id }">
          <input v-model="lengthPreset" type="radio" :name="`${uid}-length`" :value="opt.id" />
          {{ opt.label }}
        </label>
      </div>
      <div v-if="lengthPreset === 'custom'" class="vmlb-field vmlb-sum-words">
        <label :for="`${uid}-words`">Target words</label>
        <input :id="`${uid}-words`" v-model.number="wordCount" type="number" min="20" max="2000" step="10" class="vmlb-num" />
      </div>
    </fieldset>

    <fieldset v-if="choices.length" class="vmlb-sum-fieldset">
      <legend class="vmlb-label">Model</legend>
      <div class="vmlb-field vmlb-sum-model">
        <select v-model="selectedModel" aria-label="Summarisation model">
          <optgroup label="Extractive: picks sentences from the text">
            <option v-for="m in extractive" :key="m.id" :value="m.id">{{ m.label }}</option>
          </optgroup>
          <optgroup v-if="abstractive.length" label="Abstractive: writes a new summary">
            <option v-for="m in abstractive" :key="m.id" :value="m.id" :disabled="m.disabled">
              {{ m.label }}{{ m.disabled ? ' (not available)' : '' }}
            </option>
          </optgroup>
        </select>
      </div>
      <p v-if="selectedChoice?.description" class="vmlb-hint">{{ selectedChoice.description }}</p>
      <p v-if="abstractive.length && abstractive[0].disabled" class="vmlb-hint">
        Abstractive models are not available on this server.
      </p>
    </fieldset>
    <p v-else-if="modelsError" class="vmlb-hint vmlb-sum-models-error">
      Could not load the models ({{ modelsError }}). The server's default model is used.
    </p>

    <fieldset class="vmlb-sum-fieldset">
      <legend class="vmlb-label">Priority</legend>
      <div class="vmlb-sum-slider">
        <label :for="`${uid}-relevance`">Relevance <span class="vmlb-num vmlb-muted">{{ relevance.toFixed(1) }}</span></label>
        <input :id="`${uid}-relevance`" v-model.number="relevance" type="range" min="0" max="1" step="0.1" />
      </div>
      <div class="vmlb-sum-slider">
        <label :for="`${uid}-readability`">Readability <span class="vmlb-num vmlb-muted">{{ readability.toFixed(1) }}</span></label>
        <input :id="`${uid}-readability`" v-model.number="readability" type="range" min="0" max="1" step="0.1" />
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.vmlb-field input, .vmlb-field select, .vmlb-field textarea { box-sizing: border-box; }
.vmlb-sum-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--vmlb-space-lg); margin-top: var(--vmlb-space-lg); }
.vmlb-sum-fieldset { min-width: 0; margin: 0; padding: 0; border: none; }
.vmlb-sum-fieldset legend { margin-bottom: var(--vmlb-space-xs); padding: 0; }
.vmlb-sum-segmented { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--vmlb-border-strong); border-radius: var(--vmlb-radius-md); overflow: hidden; }
.vmlb-sum-segmented label {
  position: relative; padding: 0.4rem 0.75rem; font-size: 0.8125rem; font-weight: 600;
  color: var(--vmlb-text-muted); background: var(--vmlb-surface); cursor: pointer;
  transition: background-color var(--vmlb-duration) var(--vmlb-ease), color var(--vmlb-duration) var(--vmlb-ease);
}
.vmlb-sum-segmented label + label { border-left: 1px solid var(--vmlb-border); }
.vmlb-sum-segmented label:hover { color: var(--vmlb-text); }
.vmlb-sum-segmented label.active { background: var(--vmlb-accent-soft); color: var(--vmlb-accent-strong); }
.vmlb-sum-segmented input { position: absolute; opacity: 0; pointer-events: none; }
.vmlb-sum-segmented label:has(input:focus-visible) { outline: 2px solid var(--vmlb-accent); outline-offset: -2px; }
.vmlb-sum-words { margin: var(--vmlb-space-sm) 0 0; max-width: 10rem; }
.vmlb-sum-model { margin-bottom: var(--vmlb-space-xs); }
.vmlb-sum-fieldset .vmlb-hint { margin: 0.25rem 0 0; }
.vmlb-sum-models-error { align-self: start; margin: 0; }
.vmlb-sum-slider { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: var(--vmlb-space-sm); }
.vmlb-sum-slider label { display: flex; justify-content: space-between; font-size: 0.8125rem; font-weight: 600; }
.vmlb-sum-slider input { width: 100%; accent-color: var(--vmlb-accent); }
</style>
