<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { count } from '../annotation/annotationState'
import { CHECK_SAMPLE, type RestScope } from '../annotation/guide'
import { tokens } from '../annotation/llmAssist'
import type { LlmEstimate, LlmJob, LlmStatus } from '../types'
import Icon from './shared/Icon.vue'

// Step 5, "Do the rest": the AI labels the items still waiting, after the
// student has seen what it costs. What it makes are suggestions until the
// student accepts them (BAIGLE ADR 0003). The work goes through the guide's
// `useLlmAssist`; the job's progress is announced by the guide's live region.

const props = defineProps<{
  status: LlmStatus | null
  /** Items still waiting for a label; null when unknown. */
  pending: number | null
  /** Of those, the items the AI can still label: none of them has an answer
   * from the model and prompt in use yet. Null when unknown. */
  labellable?: number | null
  /** Every label has enough confirmed examples to train on. */
  canFinish?: boolean
  /** The next N items can be chosen (the adapter lists pending items). */
  canChoose: boolean
  estimate: LlmEstimate | null
  job: LlmJob | null
  /** The AI's labels waiting for the student, from the passed check's model and prompt. */
  aiLabels: number
  /** Of those, the suggestions left from Try it (and the one for the item on screen). */
  tryWaiting?: number
  /** The AI's labels can be checked one by one first. */
  canCheck: boolean
  /** Working out the cost. */
  estimating: boolean
  /** Starting the job, or accepting. */
  busy: boolean
  error: string | null
}>()
const emit = defineEmits<{
  (e: 'estimate', scope: RestScope): void
  /** The choice of items changed, so the estimate on screen is for other items. */
  (e: 'change'): void
  (e: 'start'): void
  (e: 'carry-on', scope: RestScope): void
  (e: 'accept'): void
  (e: 'check'): void
  /** Go on to Ready to train for this visit, leaving the rest for later. */
  (e: 'finish'): void
}>()

/** The items the AI would label: those it can still label, when known. */
const toLabel = computed(() => props.labellable ?? props.pending)
const scope = ref<'all' | 'next'>('all')
const nextCount = ref(Math.min(50, Math.max(toLabel.value ?? 50, 1)))
const chosen = computed<RestScope>(() => ({ count: scope.value === 'next' ? Math.max(1, Math.floor(nextCount.value || 1)) : null }))
watch([scope, nextCount], () => emit('change'))

/** The AI's labels are waiting, but the student chose to let it label more first. */
const wantMore = ref(false)
/** Nothing is left for the AI to label, as the lists or the last estimate say. */
const nothingMore = computed(() => props.labellable === 0 || props.estimate?.tasks === 0)
/** Items the AI can still label, beside those waiting to be accepted. None once
 * an estimate found nothing more, so "Let the AI label more first" goes. */
const unlabelled = computed(() =>
  nothingMore.value ? 0 : props.labellable ?? (props.pending === null ? 0 : Math.max(props.pending - props.aiLabels, 0)),
)
/** The AI has labelled items: waiting labels beyond Try it's suggestions, or a
 * finished job's (its one item may be the one on screen). Try it's alone don't
 * count, so a student arriving from Try it still chooses the items and sees the
 * cost first, unless there is nothing left for the AI to label. */
const labelsReady = computed(
  () =>
    props.aiLabels > 0 &&
    (nothingMore.value || props.job?.status === 'completed' || props.aiLabels - (props.tryWaiting ?? 0) > 0),
)
const view = computed(() => {
  const status = props.job?.status
  if (status === 'queued' || status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (labelsReady.value && (!wantMore.value || nothingMore.value)) return 'done'
  // What is left already has the AI's answer: only the student can label it.
  // An estimate covering no items says the same, if the lists changed meanwhile.
  if (nothingMore.value) return 'left'
  return 'choose'
})

/** Carry on after a stop: the labels made so far stay waiting, and the student
 * chooses what the AI labels next, with a new estimate. */
function carryOn() {
  wantMore.value = true
  emit('carry-on', chosen.value)
}
watch(view, (value) => {
  if (value === 'running') wantMore.value = false
})

// The button pressed is often replaced (Work out the cost by Start, Start by
// the progress): when focus is lost with it, it moves to the step's next
// control, or to the step itself, never left on the page.
const root = ref<HTMLElement | null>(null)
watch([view, () => !!props.estimate], async () => {
  await nextTick()
  if (typeof document === 'undefined' || (document.activeElement && document.activeElement !== document.body)) return
  const next = root.value?.querySelector<HTMLElement>('.vmlb-guide-actions button:not([disabled])')
  ;(next ?? root.value)?.focus()
})
const ownKey = computed(() => props.status?.mode === 'byok')
const checkCount = computed(() => Math.min(CHECK_SAMPLE, props.aiLabels))
</script>

<template>
  <div ref="root" class="vmlb-guide-rest" tabindex="-1">
    <template v-if="view === 'choose'">
      <p class="vmlb-guide-text">
        The AI agreed with you often enough to label the rest. Its labels wait for you to accept them: none becomes a
        label before you do.
      </p>
      <p v-if="aiLabels > 0" class="vmlb-guide-text vmlb-num">
        {{ count(aiLabels, 'AI label') }} {{ aiLabels === 1 ? 'is' : 'are' }} already waiting. {{ aiLabels === 1 ? 'It is' : 'They are' }} kept, and you accept {{ aiLabels === 1 ? 'it' : 'them' }} with the rest.
      </p>
      <fieldset class="vmlb-guide-scope" :disabled="estimating || busy">
        <legend>Which items should the AI label?</legend>
        <label class="vmlb-guide-option">
          <input v-model="scope" type="radio" name="vmlb-guide-scope" value="all" />
          <span>Every item still to label<span v-if="toLabel !== null" class="vmlb-num"> ({{ toLabel }})</span></span>
        </label>
        <label v-if="canChoose" class="vmlb-guide-option">
          <input v-model="scope" type="radio" name="vmlb-guide-scope" value="next" />
          <span>Only the next N items</span>
        </label>
        <div v-if="canChoose && scope === 'next'" class="vmlb-field vmlb-guide-count-field">
          <label for="vmlb-guide-next-count">How many items</label>
          <input id="vmlb-guide-next-count" v-model.number="nextCount" class="vmlb-guide-input" type="number" min="1" :max="toLabel ?? undefined" />
        </div>
      </fieldset>

      <div v-if="estimate" class="vmlb-guide-estimate">
        <p class="vmlb-guide-text vmlb-num">
          About {{ tokens(estimate.estimated_tokens) }} tokens.<template v-if="estimate.remaining_tokens !== null"> You have {{ tokens(estimate.remaining_tokens) }} left this month.</template>
        </p>
        <p v-if="ownKey" class="vmlb-guide-text">This uses your own key, so your AI provider charges you for these tokens.</p>
        <p class="vmlb-guide-hint">The text of {{ count(estimate.tasks, 'item') }} is sent to {{ estimate.destination }}.</p>
        <p v-if="!estimate.within_budget" class="vmlb-guide-warning" role="alert">
          <Icon name="alert" /> <span>That's more than you have left this month. Choose fewer items, or add your own key.</span>
        </p>
      </div>

      <div class="vmlb-guide-actions">
        <button
          v-if="estimate && estimate.within_budget && estimate.tasks > 0"
          type="button"
          class="vmlb-btn-primary vmlb-guide-target"
          :disabled="busy"
          :aria-busy="busy ? 'true' : undefined"
          @click="emit('start')"
        >
          {{ busy ? 'Starting…' : `Start labelling ${count(estimate.tasks, 'item')}` }}
        </button>
        <button
          v-else
          type="button"
          class="vmlb-btn-primary vmlb-guide-target"
          :disabled="estimating"
          :aria-busy="estimating ? 'true' : undefined"
          @click="emit('estimate', chosen)"
        >
          {{ estimating ? 'Working out the cost…' : 'Work out the cost' }}
        </button>
        <button v-if="canFinish" type="button" class="vmlb-btn-tertiary vmlb-guide-target" :disabled="estimating || busy" @click="emit('finish')">
          Go to Ready to train
        </button>
      </div>
    </template>

    <template v-else-if="view === 'running' && job">
      <div class="vmlb-guide-job-head">
        <span>{{ job.status === 'queued' ? 'Waiting to start…' : 'Labelling…' }}</span>
        <span class="vmlb-num">{{ job.done }} of {{ count(job.total, 'item') }} done</span>
      </div>
      <div
        class="vmlb-guide-bar"
        role="progressbar"
        aria-label="Labelling progress"
        :aria-valuenow="job.done"
        aria-valuemin="0"
        :aria-valuemax="job.total"
      >
        <div class="vmlb-guide-bar-fill" :style="{ transform: `scaleX(${job.total ? job.done / job.total : 0})` }" />
      </div>
      <p class="vmlb-guide-hint">You can leave this page. The AI carries on, and this shows how far it got when you come back.</p>
    </template>

    <template v-else-if="view === 'failed' && job">
      <p class="vmlb-guide-error" role="alert">
        <Icon name="alert" /> Labelling stopped after {{ job.done }} of {{ job.total }}. Those {{ job.created ?? job.done }} are kept.
      </p>
      <div class="vmlb-guide-actions">
        <button
          type="button"
          class="vmlb-btn-primary vmlb-guide-target"
          :disabled="estimating"
          :aria-busy="estimating ? 'true' : undefined"
          @click="carryOn"
        >
          {{ estimating ? 'Working out the cost…' : 'Carry on' }}
        </button>
      </div>
    </template>

    <template v-else-if="view === 'done'">
      <p class="vmlb-guide-text">
        <template v-if="aiLabels === 1">The AI labelled 1 item. It isn't a label yet: accept it to make it yours, or check it first.</template>
        <template v-else>The AI labelled {{ count(aiLabels, 'item') }}. They aren't labels yet: accept them to make them yours, or check some first.</template>
      </p>
      <div class="vmlb-guide-actions">
        <button type="button" class="vmlb-btn-primary vmlb-guide-target" :disabled="busy" :aria-busy="busy ? 'true' : undefined" @click="emit('accept')">
          {{ busy ? 'Accepting…' : `Accept ${aiLabels} AI ${aiLabels === 1 ? 'label' : 'labels'}` }}
        </button>
        <button v-if="canCheck" type="button" class="vmlb-btn-secondary vmlb-guide-target" :disabled="busy" @click="emit('check')">
          {{ checkCount === CHECK_SAMPLE ? `Check ${CHECK_SAMPLE} at random first` : `Check ${checkCount === 1 ? 'it' : `all ${checkCount}`} first` }}
        </button>
        <button v-if="unlabelled > 0" type="button" class="vmlb-btn-tertiary vmlb-guide-target" :disabled="busy" @click="wantMore = true">
          Let the AI label more first
        </button>
        <button v-if="canFinish" type="button" class="vmlb-btn-tertiary vmlb-guide-target" :disabled="busy" @click="emit('finish')">
          Go to Ready to train
        </button>
      </div>
    </template>

    <template v-else-if="view === 'left'">
      <p class="vmlb-guide-text vmlb-num">
        {{ count(pending ?? 0, 'item') }} {{ pending === 1 ? 'is' : 'are' }} left for you to label.
      </p>
      <p class="vmlb-guide-hint">
        The AI has already given its answer on {{ pending === 1 ? 'it' : 'each of them' }}, so it won't label {{ pending === 1 ? 'it' : 'them' }} again. Label {{ pending === 1 ? 'it' : 'them' }} yourself in the item below.
      </p>
      <div v-if="canFinish" class="vmlb-guide-actions">
        <button type="button" class="vmlb-btn-secondary vmlb-guide-target" @click="emit('finish')">Go to Ready to train</button>
      </div>
    </template>

    <p v-if="error" class="vmlb-guide-error" role="alert"><Icon name="alert" /> {{ error }}</p>
  </div>
</template>

<style scoped>
.vmlb-guide-rest { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-rest:focus { outline: none; }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-hint { margin: 0; color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-scope { display: flex; flex-direction: column; gap: var(--vmlb-space-2xs); margin: 0; padding: 0; border: 0; }
.vmlb-guide-scope legend { margin-bottom: var(--vmlb-space-2xs); padding: 0; font-weight: 600; }
.vmlb-guide-option { display: flex; align-items: center; gap: var(--vmlb-space-xs); min-height: 2.75rem; cursor: pointer; }
.vmlb-guide-option input { width: 1.125rem; height: 1.125rem; margin: 0; accent-color: var(--vmlb-accent); }
.vmlb-guide-count-field { max-width: 14rem; margin: 0 0 0 calc(1.125rem + var(--vmlb-space-xs)); }
.vmlb-guide-input { min-height: 2.75rem; }
.vmlb-guide-estimate { display: flex; flex-direction: column; gap: var(--vmlb-space-2xs); }
.vmlb-guide-actions { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-sm); }
.vmlb-guide-target { min-height: 2.75rem; }
.vmlb-guide-rest :focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-guide-job-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--vmlb-space-md); }
.vmlb-guide-bar { width: 100%; height: 0.5rem; overflow: hidden; background: var(--vmlb-surface-sunken); border: 1px solid var(--vmlb-border); border-radius: 999px; }
.vmlb-guide-bar-fill { width: 100%; height: 100%; background: var(--vmlb-accent); transform-origin: left center; transition: transform 0.35s var(--vmlb-ease); }
@media (prefers-reduced-motion: reduce) { .vmlb-guide-bar-fill { transition: none; } }
.vmlb-guide-warning {
  display: flex; align-items: flex-start; gap: var(--vmlb-space-xs); margin: 0;
  padding: var(--vmlb-space-sm) var(--vmlb-space-md); border-radius: var(--vmlb-radius-md);
  background: var(--vmlb-warning-soft); color: var(--vmlb-text);
}
.vmlb-guide-error { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }
.vmlb-num { font-variant-numeric: tabular-nums; }
</style>
