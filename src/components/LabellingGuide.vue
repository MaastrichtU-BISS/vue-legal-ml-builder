<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import {
  GUIDE_STEPS,
  guideStep,
  readPendingDescriptions,
  stepIndex,
  writePendingDescriptions,
  type GuideStepKey,
} from '../annotation/guide'
import { useLlmAssist } from '../composables/useLlmAssist'
import type { AnnotationStats, Dataset, Id, LlmAgreement, LlmStatus, LlmSuggestion, MLAdapter } from '../types'
import GuideLabelsStep from './GuideLabelsStep.vue'
import LlmAssistPanel from './LlmAssistPanel.vue'
import Icon from './shared/Icon.vue'

// The guided "Label with AI help" mode: one panel with the six-step rail, a
// hairline, then the current step. The step is worked out from what the
// server reports each time, never stored.

const props = defineProps<{
  adapter: MLAdapter
  projectId: Id
  datasetId: Id
  /** The Dataset's named labels. */
  labels: string[]
  /** Labels already used on an item, as the workspace knows them. */
  inUse: string[]
  /** The queue's counts; null until the workspace has them. */
  stats: AnnotationStats | null
  statsLoading: boolean
  /** Bumped by the workspace after each saved label. */
  labelsVersion: number
  currentTaskId?: Id | null
}>()
const emit = defineEmits<{
  (e: 'hide'): void
  /** Loaded once: whether the Dataset already has LLM suggestions. */
  (e: 'loaded', loaded: { hasSuggestions: boolean }): void
  (e: 'labels-saved', saved: { dataset: Dataset; labels: string[] }): void
  /** The sentence for each label, for the labelling sidebar. */
  (e: 'descriptions', descriptions: Record<string, string>): void
  (e: 'suggestions', suggestions: LlmSuggestion[]): void
  (e: 'labelled'): void
}>()

const llm = useLlmAssist(props.adapter, inject<number>('vmlb:pollInterval', 3000))
const { status, agreement, prompt, promptError, hasAccess, ready } = llm

const loadState = ref<'loading' | 'ready' | 'error'>('loading')
/** Confirmed labels per label; null when the server cannot count them. */
const perLabel = ref<Record<string, number> | null>(null)
/** Descriptions saved with the labels but not yet in a prompt version. */
const pendingDescriptions = ref<Record<string, string> | null>(readPendingDescriptions(props.datasetId))
const heading = ref<HTMLElement | null>(null)
let announcedLoad = false

const inUseLabels = computed(() => {
  const counted = Object.entries(perLabel.value ?? {}).filter(([, n]) => n > 0).map(([label]) => label)
  return [...new Set([...props.inUse, ...counted])]
})
const confirmedTotal = computed(() =>
  perLabel.value ? Object.values(perLabel.value).reduce((sum, n) => sum + n, 0) : props.stats?.annotated ?? 0,
)
const pending = computed(() =>
  props.stats ? Math.max(props.stats.total - props.stats.annotated - (props.stats.holdout_remaining ?? 0), 0) : null,
)
const descriptions = computed<Record<string, string>>(() => ({
  ...(prompt.value?.definitions ?? {}),
  ...(pendingDescriptions.value ?? {}),
}))

const step = computed<GuideStepKey>(() =>
  guideStep({
    labels: props.labels,
    hasAccess: hasAccess.value,
    acknowledged: !!status.value?.acknowledged,
    confirmedPerLabel: perLabel.value,
    confirmedTotal: confirmedTotal.value,
    pending: pending.value,
    agreement: agreement.value,
  }),
)
const current = computed(() => stepIndex(step.value))
const currentStep = computed(() => GUIDE_STEPS[current.value])
const showing = computed(() => (loadState.value === 'ready' && (props.stats || !props.statsLoading) ? 'ready' : loadState.value === 'error' ? 'error' : 'loading'))

/** Confirmed labels per label, one count per label from the server. */
async function loadCounts(): Promise<Record<string, number> | null> {
  if (!props.labels.length) return {}
  if (props.adapter.pageAnnotationTasks) {
    const totals = await Promise.all(
      props.labels.map((label) =>
        props.adapter.pageAnnotationTasks!(props.projectId, { status: 'annotated', datasetId: props.datasetId, label, limit: 1 })
          .then((page) => page.total),
      ),
    )
    return Object.fromEntries(props.labels.map((label, i) => [label, totals[i]]))
  }
  if (props.adapter.getActiveLearningState) {
    const state = await props.adapter.getActiveLearningState(props.datasetId)
    return state.active ? state.label_counts : null
  }
  return null
}

async function load() {
  loadState.value = 'loading'
  try {
    await llm.refresh(props.datasetId)
    if (llm.error.value) throw new Error(llm.error.value)
    perLabel.value = await loadCounts()
    loadState.value = 'ready'
  } catch {
    loadState.value = 'error'
    return
  }
  if (!announcedLoad) {
    announcedLoad = true
    emit('loaded', { hasSuggestions: (agreement.value?.checked ?? 0) > 0 || llm.suggestions.value.length > 0 })
  }
  await syncDescriptions()
}

async function refreshCounts() {
  if (loadState.value !== 'ready') return
  try {
    perLabel.value = await loadCounts()
  } catch {
    // The step is worked out from the last counts until the next refresh.
  }
}

let syncing = false
/** Loads the prompt and, when descriptions are still waiting, saves them as a
 * new prompt version with the template unchanged. Without LLM access the
 * prompt can't be read or saved, so they wait (in browser storage too) until
 * the next time the prompt loads. */
async function syncDescriptions() {
  emit('descriptions', descriptions.value)
  if (syncing || !hasAccess.value || !props.adapter.getLlmPrompt) return
  syncing = true
  try {
    await llm.loadPrompt(props.datasetId)
    const loaded = prompt.value
    const waiting = pendingDescriptions.value
    if (loaded && waiting && props.adapter.updateLlmPrompt) {
      const definitions = Object.fromEntries(Object.entries(waiting).filter(([, text]) => text.trim()))
      await llm.savePrompt(props.datasetId, { template: loaded.template, definitions })
      if (!promptError.value) {
        pendingDescriptions.value = null
        writePendingDescriptions(props.datasetId, null)
      }
    }
  } finally {
    syncing = false
    emit('descriptions', descriptions.value)
  }
}

async function onLabelsSaved(saved: { dataset: Dataset; labels: string[]; descriptions: Record<string, string> }) {
  pendingDescriptions.value = saved.descriptions
  writePendingDescriptions(props.datasetId, saved.descriptions)
  emit('labels-saved', { dataset: saved.dataset, labels: saved.labels })
  await syncDescriptions()
}

/** Today's panel, inside the step, keeps the guide's step up to date. */
function onPanelState(state: { status: LlmStatus | null; agreement: LlmAgreement | null }) {
  if (state.status) status.value = state.status
  // The panel reads its status before its agreement; a passing null would flip the step.
  if (state.agreement) agreement.value = state.agreement
}

onMounted(load)
watch(() => props.datasetId, () => {
  pendingDescriptions.value = readPendingDescriptions(props.datasetId)
  announcedLoad = false
  load()
})
watch(() => props.labels.join('\u0000'), refreshCounts)
watch(() => props.labelsVersion, async () => {
  await refreshCounts()
  await llm.refreshProgress(props.datasetId)
})
// Access arriving (a key saved, sending allowed) is when waiting descriptions can be saved.
watch(ready, (value) => {
  if (value && pendingDescriptions.value) syncDescriptions()
})
// Focus follows a step change, not the first render.
let shownStep: GuideStepKey | null = null
watch([step, showing], async ([next, state]) => {
  if (state !== 'ready') return
  const previous = shownStep
  shownStep = next
  if (previous === null || previous === next) return
  await nextTick()
  heading.value?.focus()
})
</script>

<template>
  <section class="vmlb-guide" aria-labelledby="vmlb-guide-title" :aria-busy="showing === 'loading' ? 'true' : undefined">
    <div class="vmlb-guide-head">
      <h2 id="vmlb-guide-title" class="vmlb-guide-title">Label with AI help</h2>
      <button type="button" class="vmlb-guide-hide" @click="emit('hide')">Hide guide</button>
    </div>

    <div v-if="showing === 'loading'" class="vmlb-guide-skeleton" role="status">
      <span class="vmlb-guide-sr">Loading your labelling progress</span>
      <div class="vmlb-skeleton vmlb-guide-skeleton-rail" />
      <hr class="vmlb-guide-rule" />
      <div class="vmlb-skeleton vmlb-skeleton-line" style="width: 40%" />
      <div class="vmlb-skeleton vmlb-skeleton-line" style="width: 85%" />
      <div class="vmlb-skeleton vmlb-guide-skeleton-body" />
    </div>

    <div v-else-if="showing === 'error'" class="vmlb-guide-failed">
      <p role="alert"><Icon name="alert" /> Couldn't load your labelling progress.</p>
      <button type="button" class="vmlb-btn-secondary vmlb-guide-target" @click="load">Try again</button>
    </div>

    <template v-else>
      <nav class="vmlb-guide-rail" aria-label="Steps">
        <ol>
          <li
            v-for="(s, i) in GUIDE_STEPS"
            :key="s.key"
            class="vmlb-guide-rail-step"
            :class="{ 'is-done': i < current, 'is-current': i === current }"
            :aria-current="i === current ? 'step' : undefined"
          >
            <span class="vmlb-guide-marker">
              <template v-if="i < current"><Icon name="check" /><span class="vmlb-guide-sr">Done:</span></template>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="vmlb-guide-rail-name">{{ s.short }}</span>
          </li>
        </ol>
      </nav>
      <div class="vmlb-guide-compact">
        <p>Step {{ current + 1 }} of {{ GUIDE_STEPS.length }} · <strong>{{ currentStep.short }}</strong></p>
        <div class="vmlb-guide-segments" aria-hidden="true">
          <span v-for="(s, i) in GUIDE_STEPS" :key="s.key" :class="{ 'is-filled': i <= current }" />
        </div>
      </div>

      <hr class="vmlb-guide-rule" />

      <div class="vmlb-guide-step">
        <h3 ref="heading" class="vmlb-guide-step-title" tabindex="-1">{{ currentStep.title }}</h3>
        <p v-if="currentStep.time" class="vmlb-guide-time">{{ currentStep.time }}</p>

        <GuideLabelsStep
          v-if="step === 'labels' && adapter.setDatasetLabels"
          :adapter="adapter"
          :dataset-id="datasetId"
          :labels="labels"
          :in-use="inUseLabels"
          :descriptions="descriptions"
          @saved="onLabelsSaved"
        />
        <p v-else-if="step === 'labels'" class="vmlb-guide-text">Labels can't be named here. Ask whoever runs this platform to add them.</p>
        <!-- Temporary (BAIGLE #193): steps 2–6 show today's AI controls under the
             step title until #194–#196 give each step its own words and controls. -->
        <LlmAssistPanel
          v-else
          embedded
          :adapter="adapter"
          :project-id="projectId"
          :dataset-id="datasetId"
          :labels="labels"
          :current-task-id="currentTaskId ?? null"
          :labels-version="labelsVersion"
          @suggestions="emit('suggestions', $event)"
          @labelled="emit('labelled')"
          @state="onPanelState"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
/* One panel in the host's callout style: a light primary tint, a primary-100
   border and the large radius. No cards inside it. */
.vmlb-guide {
  margin-bottom: var(--vmlb-space-lg);
  padding: var(--vmlb-space-md) var(--vmlb-space-lg);
  border: 1px solid color-mix(in srgb, var(--vmlb-accent) 22%, var(--vmlb-surface));
  border-radius: var(--vmlb-radius-lg);
  background: color-mix(in srgb, var(--vmlb-accent-soft) 60%, var(--vmlb-surface));
  color: var(--vmlb-text);
  font-size: var(--vmlb-font-size-md);
}
.vmlb-guide :focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-guide-head { display: flex; align-items: center; justify-content: space-between; gap: var(--vmlb-space-sm); }
.vmlb-guide-title { margin: 0; font-size: var(--vmlb-font-size-base); font-weight: 600; }
.vmlb-guide-hide {
  min-height: 2.75rem; padding: 0 var(--vmlb-space-2xs);
  border: 0; background: none; color: var(--vmlb-text-muted);
  font: inherit; font-size: var(--vmlb-font-size-sm);
  text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
}
.vmlb-guide-hide:hover { color: var(--vmlb-text); }
.vmlb-guide-target { min-height: 2.75rem; }

.vmlb-guide-rail ol { display: flex; align-items: flex-start; margin: var(--vmlb-space-sm) 0 0; padding: 0; list-style: none; }
.vmlb-guide-rail-step { position: relative; display: flex; flex: 1; flex-direction: column; align-items: center; text-align: center; color: var(--vmlb-text-muted); }
.vmlb-guide-rail-step + .vmlb-guide-rail-step::before {
  content: ''; position: absolute; top: 0.875rem; right: 50%; width: 100%; height: 1px;
  background: var(--vmlb-border-strong);
}
.vmlb-guide-rail-step.is-done + .vmlb-guide-rail-step::before,
.vmlb-guide-rail-step.is-current::before { background: var(--vmlb-accent); }
.vmlb-guide-marker {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.75rem; height: 1.75rem; border-radius: 999px;
  background: var(--vmlb-surface); box-shadow: inset 0 0 0 1px var(--vmlb-border-strong);
  font-size: var(--vmlb-font-size-xs); font-weight: 600; font-variant-numeric: tabular-nums;
}
.is-done .vmlb-guide-marker { background: var(--vmlb-accent); color: var(--vmlb-on-accent); box-shadow: none; }
.is-current .vmlb-guide-marker { color: var(--vmlb-accent-strong); box-shadow: inset 0 0 0 2px var(--vmlb-accent); }
.vmlb-guide-rail-name { margin-top: var(--vmlb-space-2xs); padding: 0 var(--vmlb-space-2xs); font-size: var(--vmlb-font-size-xs); line-height: 1.25; }
.is-done .vmlb-guide-rail-name { color: var(--vmlb-text); }
.is-current .vmlb-guide-rail-name { color: var(--vmlb-text); font-weight: 700; }

.vmlb-guide-compact { display: none; }
.vmlb-guide-compact p { margin: var(--vmlb-space-xs) 0 0; font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-segments { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--vmlb-space-2xs); margin-top: var(--vmlb-space-xs); }
.vmlb-guide-segments span { height: 0.375rem; border-radius: 999px; background: var(--vmlb-border-strong); }
.vmlb-guide-segments span.is-filled { background: var(--vmlb-accent); }

.vmlb-guide-rule { margin: var(--vmlb-space-md) 0; border: 0; border-top: 1px solid color-mix(in srgb, var(--vmlb-accent) 22%, var(--vmlb-surface)); }
.vmlb-guide-step-title { margin: 0; font-size: var(--vmlb-font-size-lg); font-weight: 600; }
.vmlb-guide-step-title:focus { outline: none; }
.vmlb-guide-step-title:focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-guide-time { margin: var(--vmlb-space-2xs) 0 var(--vmlb-space-sm); color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-text { margin: 0; }

/* The skeleton takes the room the loaded panel takes. */
.vmlb-guide-skeleton { display: flex; flex-direction: column; gap: var(--vmlb-space-xs); min-height: 16rem; }
.vmlb-guide-skeleton .vmlb-guide-rule { margin: var(--vmlb-space-xs) 0; }
.vmlb-guide-skeleton-rail { height: 3.25rem; margin-top: var(--vmlb-space-sm); }
.vmlb-guide-skeleton-body { height: 6rem; }
.vmlb-guide-failed { display: flex; flex-wrap: wrap; align-items: center; gap: var(--vmlb-space-sm); min-height: 16rem; align-content: center; }
.vmlb-guide-failed p { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }
.vmlb-guide-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Phones: the rail becomes one line over a six-segment bar. */
@media (max-width: 640px) {
  .vmlb-guide { padding: var(--vmlb-space-sm) var(--vmlb-space-md); }
  .vmlb-guide-rail { display: none; }
  .vmlb-guide-compact { display: block; }
}
</style>
