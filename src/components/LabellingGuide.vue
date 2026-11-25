<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import {
  GUIDE_STEPS,
  SHOW_TOTAL,
  agreementLow,
  currentAgreement,
  definitionsToFill,
  guideStep,
  readPendingDescriptions,
  showTargets,
  stepIndex,
  stepsMet,
  writePendingDescriptions,
  type Disagreement,
  type GuideProgress,
  type GuideStepKey,
  type TryView,
} from '../annotation/guide'
import { newestFirst, waitingSuggestion } from '../annotation/llmAssist'
import { useLlmAssist } from '../composables/useLlmAssist'
import type { AnnotationStats, AnnotationTask, Dataset, Id, LlmAgreement, LlmKeyInput, LlmStatus, LlmSuggestion, MLAdapter } from '../types'
import GuideConnectStep from './GuideConnectStep.vue'
import GuideImproveStep from './GuideImproveStep.vue'
import GuideLabelsStep from './GuideLabelsStep.vue'
import GuideShowStep from './GuideShowStep.vue'
import GuideTryStep from './GuideTryStep.vue'
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
  /** The item on screen is kept aside to test the model. */
  currentHoldout?: boolean
  /** The workspace is saving a label. */
  busy?: boolean
}>()
const emit = defineEmits<{
  (e: 'hide'): void
  /** Loaded once: whether the Dataset already has LLM suggestions, or a
   * Model-led loop running. */
  (e: 'loaded', loaded: { hasSuggestions: boolean; loopRunning: boolean }): void
  (e: 'labels-saved', saved: { dataset: Dataset; labels: string[] }): void
  /** The sentence for each label, for the labelling sidebar. */
  (e: 'descriptions', descriptions: Record<string, string>): void
  (e: 'suggestions', suggestions: LlmSuggestion[]): void
  (e: 'labelled'): void
  /** The step on screen, so the workspace leaves Try it's suggestion to the guide. */
  (e: 'step', step: GuideStepKey): void
  /** Try it: the student accepted the suggestion, or picked their own label over it. */
  (e: 'answer', answer: { suggestionId: Id; label?: string }): void
  (e: 'skip'): void
}>()

const llm = useLlmAssist(props.adapter, inject<number>('vmlb:pollInterval', 3000))
const { status, agreement, prompt, promptError, hasAccess, ready, budgetExhausted } = llm

const loadState = ref<'loading' | 'ready' | 'error'>('loading')
/** Confirmed labels per label; null when the server cannot count them. With
 * fewer than two named labels, the labels found on items and their counts. */
const perLabel = ref<Record<string, number> | null>(null)
/** Descriptions saved with the labels but not yet in a prompt version. */
const pendingDescriptions = ref<Record<string, string> | null>(readPendingDescriptions(props.datasetId))
/** Typed in this visit, so newer than the prompt's definitions. Descriptions
 * waiting from an earlier visit only fill definitions that are still empty. */
const pendingFresh = ref(false)
/** Why the descriptions saved with the labels aren't in the prompt yet. */
const sentencesError = ref<string | null>(null)
const heading = ref<HTMLElement | null>(null)
const detailsToggle = ref<HTMLButtonElement | null>(null)
let announcedLoad = false

const inUseLabels = computed(() => {
  const counted = Object.entries(perLabel.value ?? {}).filter(([, n]) => n > 0).map(([label]) => label)
  return [...new Set([...props.inUse, ...counted])]
})
const confirmedTotal = computed(() =>
  perLabel.value ? Object.values(perLabel.value).reduce((sum, n) => sum + n, 0) : props.stats?.annotated ?? 0,
)
/** Items still waiting. An empty queue is not finished work (the workspace
 * calls it unavailable), so it says nothing about what is left. */
const pending = computed(() =>
  props.stats && props.stats.total > 0
    ? Math.max(props.stats.total - props.stats.annotated - (props.stats.holdout_remaining ?? 0), 0)
    : null,
)
const descriptions = computed<Record<string, string>>(() => {
  const defined = prompt.value?.definitions ?? {}
  const waiting = Object.entries(pendingDescriptions.value ?? {}).filter(
    ([label, text]) => text.trim() && (pendingFresh.value || !defined[label]?.trim()),
  )
  return { ...defined, ...Object.fromEntries(waiting) }
})

/** The prompt version and model suggestions come from now. The version is
 * unknown until the prompt loads. */
const inUse = computed(() => ({ promptVersion: prompt.value?.version ?? null, model: status.value?.model ?? null }))
/** The agreement check for the prompt and model in use: a new prompt version
 * starts it from zero straight away, before the server's first new suggestion. */
const check = computed(() => currentAgreement(agreement.value, inUse.value))

const progress = computed<GuideProgress>(() => ({
  labels: props.labels,
  // A shared allowance used up sends the student back to Connect AI.
  hasAccess: hasAccess.value && !budgetExhausted.value,
  acknowledged: !!status.value?.acknowledged,
  confirmedPerLabel: props.labels.length >= 2 ? perLabel.value : null,
  confirmedTotal: confirmedTotal.value,
  pending: pending.value,
  agreement: check.value,
}))
const step = computed<GuideStepKey>(() => guideStep(progress.value))
const met = computed(() => stepsMet(progress.value))
const current = computed(() => stepIndex(step.value))
const currentStep = computed(() => GUIDE_STEPS[current.value])
const targets = computed(() => showTargets(progress.value))
/** Try it, chosen for this visit over improving the descriptions. Never
 * unlocks bulk accept: only the server's check moves the guide on. */
const keepGoing = ref(false)
/** Try it's improving state: the full sample checked, the agreement too low. */
const improving = computed(() => step.value === 'try' && agreementLow(check.value) && !keepGoing.value)
/** The step as shown: Try it and its improving state each take focus when they appear. */
const stepView = computed(() => (improving.value ? 'improve' : step.value))
/** Sending allowed in this visit: Show it how opens with the hand-off line. */
const justConnected = ref(false)
/** Phones, in Show it how: the panel folds to one line until Details opens it. */
const detailsOpen = ref(false)
const collapsible = computed(() => step.value === 'show' || (step.value === 'try' && !improving.value))
/** The width at which the guide's styles fold Show it how (see the media query below). */
const PHONE_QUERY = '(max-width: 640px)'
/** The step's body is folded away on a phone, so its heading can't take focus. */
function folded(): boolean {
  if (!collapsible.value || detailsOpen.value) return false
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}
const showing = computed(() => (loadState.value === 'ready' && (props.stats || !props.statsLoading) ? 'ready' : loadState.value === 'error' ? 'error' : 'loading'))

const PAGE = 500

/** The labels on the Dataset's labelled items, with how many each: what step 1
 * locks when the Dataset names fewer than two labels (typed or file labels).
 * Pages through the labelled items, the one list that covers every source;
 * without it, the Model-led loop's counts while it runs. */
async function findUsedLabels(): Promise<Record<string, number> | null> {
  if (props.adapter.pageAnnotationTasks) {
    const counts: Record<string, number> = {}
    // Advance by what came back: an adapter may return fewer rows than asked.
    for (let offset = 0; ; ) {
      const page: { tasks: AnnotationTask[]; total: number } = await props.adapter.pageAnnotationTasks(props.projectId, {
        status: 'annotated', datasetId: props.datasetId, includeHoldout: true, limit: PAGE, offset,
      })
      for (const task of page.tasks) {
        const label = task.annotation_label?.trim()
        if (label) counts[label] = (counts[label] ?? 0) + 1
      }
      offset += page.tasks.length
      if (!page.tasks.length || offset >= page.total) break
    }
    return counts
  }
  if (props.adapter.getActiveLearningState) {
    const state = await props.adapter.getActiveLearningState(props.datasetId)
    return state.active ? state.label_counts : null
  }
  return null
}

/** Confirmed labels per label, one count per label from the server. */
async function loadCounts(): Promise<Record<string, number> | null> {
  if (props.labels.length < 2) return findUsedLabels()
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

/** Whether the Model-led loop already runs on this Dataset. */
async function loopRunning(): Promise<boolean> {
  if (!props.adapter.getActiveLearningState) return false
  try {
    return (await props.adapter.getActiveLearningState(props.datasetId)).active
  } catch {
    return false
  }
}

async function load() {
  loadState.value = 'loading'
  let running = false
  try {
    ;[running] = await Promise.all([announcedLoad ? false : loopRunning(), llm.refresh(props.datasetId)])
    if (llm.error.value) throw new Error(llm.error.value)
    perLabel.value = await loadCounts()
    loadState.value = 'ready'
  } catch {
    loadState.value = 'error'
    return
  }
  if (!announcedLoad) {
    announcedLoad = true
    emit('loaded', {
      hasSuggestions: (agreement.value?.checked ?? 0) > 0 || llm.suggestions.value.length > 0,
      loopRunning: running,
    })
  }
  await syncDescriptions()
}

let countsAsked = 0
async function refreshCounts() {
  if (loadState.value !== 'ready') return
  // With fewer than two named labels, the used labels come from paging every
  // labelled item: done once on load, not after each saved item (the workspace
  // already knows the label just saved).
  if (props.labels.length < 2) return
  const asked = ++countsAsked
  try {
    const counts = await loadCounts()
    // An older reply arriving last must not replace a newer one.
    if (asked === countsAsked) perLabel.value = counts
  } catch {
    // The step is worked out from the last counts until the next refresh.
  }
}

function clearPending() {
  pendingDescriptions.value = null
  pendingFresh.value = false
  sentencesError.value = null
  writePendingDescriptions(props.datasetId, null)
}

let syncing = false
/** A sync is running: Try again shows as busy. */
const syncBusy = ref(false)
/** A sync asked for while one runs; it runs again once that one ends. */
let rerun = false
/** Loads the prompt and, when descriptions are still waiting, saves them as a
 * new prompt version with the template unchanged. Without LLM access the
 * prompt can't be read or saved, so they wait (in browser storage too) until
 * the next time the prompt loads. */
async function syncDescriptions(): Promise<void> {
  emit('descriptions', descriptions.value)
  // Saving the prompt needs access and the Project's go-ahead to send text
  // (step 2); until then the sentences wait, and the `ready` watcher saves them.
  if (!ready.value || !props.adapter.getLlmPrompt) return
  if (syncing) {
    rerun = true
    return
  }
  // The guide is keyed by Dataset, but a reply must still match the one asked about.
  const datasetId = props.datasetId
  syncing = true
  syncBusy.value = true
  // Cleared first, so a repeat failure is announced again.
  sentencesError.value = null
  try {
    await llm.loadPrompt(datasetId)
    if (datasetId !== props.datasetId) return
    const waiting = pendingDescriptions.value
    if (!waiting) return
    if (promptError.value) {
      sentencesError.value = promptError.value
      return
    }
    const loaded = prompt.value
    if (!loaded || !props.adapter.updateLlmPrompt) return
    const defined = loaded.definitions ?? {}
    const fill = definitionsToFill(defined, waiting, pendingFresh.value)
    if (Object.keys(fill).length) {
      await llm.savePrompt(datasetId, { template: loaded.template, definitions: { ...defined, ...fill } })
      if (datasetId !== props.datasetId) return
      if (promptError.value) {
        sentencesError.value = promptError.value
        return
      }
    }
    // Saved, or the prompt already has a sentence for each of these labels.
    clearPending()
  } finally {
    syncing = false
    syncBusy.value = false
    emit('descriptions', descriptions.value)
    if (rerun) {
      rerun = false
      await syncDescriptions()
    }
  }
}

async function onLabelsSaved(saved: { dataset: Dataset; labels: string[]; descriptions: Record<string, string> }) {
  pendingDescriptions.value = saved.descriptions
  pendingFresh.value = true
  sentencesError.value = null
  writePendingDescriptions(props.datasetId, saved.descriptions)
  emit('labels-saved', { dataset: saved.dataset, labels: saved.labels })
  await syncDescriptions()
}

/** Step 2: saves the key through the guide's own LLM state. */
async function connectKey(key: LlmKeyInput) {
  await llm.saveKey(props.datasetId, key)
  return llm.error.value ? { message: llm.error.value, code: llm.errorCode.value } : null
}

/** Step 2's Allow. Set before the step changes, so Show it how opens with
 * the hand-off line, unfolded on a phone so the line is seen. */
async function allowSending() {
  const wasOpen = detailsOpen.value
  justConnected.value = true
  detailsOpen.value = true
  await llm.acknowledge(props.datasetId)
  if (!llm.error.value) return null
  justConnected.value = false
  detailsOpen.value = wasOpen
  return { code: llm.errorCode.value }
}

// ---------------------------------------------------------------------------
// Step 4, Try it: one suggestion at a time for the item on screen.
// ---------------------------------------------------------------------------

// Try it's improving state, declared first: asking waits for its save.
const disagreements = ref<Disagreement[] | null>(null)
const disagreementsFailed = ref(false)
const improveSaving = ref(false)
const improveError = ref<string | null>(null)

/** What happened to each request, by item, prompt version and model, so an
 * item is asked about once per prompt version. */
const outcomes = ref<Record<string, Exclude<TryView, 'holdout' | 'ready' | 'idle'>>>({})
const askKey = computed(() =>
  props.currentTaskId ? `${props.currentTaskId}:${inUse.value.promptVersion ?? ''}:${inUse.value.model ?? ''}` : null,
)
/** With a prompt to read, its version must be known before asking, or the
 * item would be asked about again once it loads. */
const promptKnown = computed(() => !props.adapter.getLlmPrompt || prompt.value !== null || !!promptError.value)
/** Suggestions this guide asked for and the student hasn't answered yet. A
 * reload of what is waiting can be read before a new suggestion is stored, so
 * these are kept beside it rather than lost. */
const asked = ref<LlmSuggestion[]>([])
const waiting = computed(() =>
  newestFirst([...asked.value, ...llm.suggestions.value.filter((s) => !asked.value.some((a) => a.id === s.id))]),
)
const trySuggestion = computed(() =>
  props.currentTaskId ? waitingSuggestion(waiting.value, props.currentTaskId, inUse.value) : null,
)
const tryView = computed<TryView>(() => {
  if (props.currentHoldout) return 'holdout'
  if (!props.currentTaskId) return 'idle'
  if (trySuggestion.value) return 'ready'
  return (askKey.value && outcomes.value[askKey.value]) || 'asking'
})
const trying = computed(() => showing.value === 'ready' && step.value === 'try' && !improving.value)

async function askForSuggestion() {
  const key = askKey.value
  const taskId = props.currentTaskId
  if (!trying.value || !ready.value || !promptKnown.value || improveSaving.value || props.currentHoldout || !key || !taskId) return
  if (trySuggestion.value || outcomes.value[key] || !props.adapter.createLlmSuggestions) return
  outcomes.value = { ...outcomes.value, [key]: 'asking' }
  const batch = await llm.suggestOne(props.datasetId, taskId)
  let outcome: (typeof outcomes.value)[string] = 'answered'
  if (batch) asked.value = [...asked.value, ...batch.suggestions.filter((s) => s.status === 'pending')]
  if (!batch) outcome = 'failed'
  else if (!batch.suggestions.length && batch.invalid) outcome = 'invalid'
  // Already asked with this prompt and model: what is waiting is read again.
  else if (!batch.suggestions.length) await llm.refreshProgress(props.datasetId)
  outcomes.value = { ...outcomes.value, [key]: outcome }
}

function retrySuggestion() {
  if (!askKey.value) return
  const { [askKey.value]: _failed, ...rest } = outcomes.value
  outcomes.value = rest
  void askForSuggestion()
}

/** Accept, or another label picked: the workspace saves it. */
function answer(suggestionId: Id, label?: string) {
  asked.value = asked.value.filter((s) => s.id !== suggestionId)
  emit('answer', label === undefined ? { suggestionId } : { suggestionId, label })
}

// The save of new descriptions comes first: its new prompt version is the one to ask with.
watch([trying, askKey, ready, promptKnown, () => props.currentHoldout, () => !!trySuggestion.value, () => improveSaving.value], () => {
  void askForSuggestion()
})
// While Try it shows, the guide says what waits, newest first, so the
// workspace saves a label chosen in the item over the current suggestion.
watch([() => step.value === 'try', waiting], ([onTry, list]) => {
  if (onTry) emit('suggestions', list)
})
watch(step, (value) => emit('step', value), { immediate: true })

// ---------------------------------------------------------------------------
// Try it's improving state.
// ---------------------------------------------------------------------------


/** The items the AI got wrong in the check that is too low: its corrected
 * suggestions, with each item's text and the label the student gave. */
async function loadDisagreements() {
  const forCheck = check.value
  disagreements.value = null
  disagreementsFailed.value = false
  try {
    const corrected = (await props.adapter.listLlmSuggestions?.(props.datasetId, 'corrected')) ?? []
    const inCheck = corrected.filter(
      (s) =>
        (forCheck?.model == null || s.model === forCheck.model) &&
        (forCheck?.prompt_version == null || s.prompt_version === forCheck.prompt_version),
    )
    const tasks = props.adapter.listAnnotationTasks
      ? new Map((await props.adapter.listAnnotationTasks(props.projectId, { status: 'annotated', datasetId: props.datasetId })).map((t) => [t.id, t]))
      : null
    disagreements.value = await Promise.all(
      inCheck.map(async (s): Promise<Disagreement> => {
        const task = tasks?.get(s.task_id)
        if (task) return { id: s.id, text: task.text, yours: task.annotation_label ?? '', ai: s.label }
        const opened = await props.adapter.getAnnotationAssignment(s.task_id)
        return { id: s.id, text: opened.document.full_text, yours: opened.assignment.document_annotations[0]?.label ?? '', ai: s.label }
      }),
    )
  } catch {
    disagreementsFailed.value = true
  }
}

watch(improving, (value) => {
  if (value) void loadDisagreements()
})

/** A new prompt version with the template as it is and the new descriptions.
 * The check starts again for it, so the guide returns to Try it. */
async function saveDescriptions(definitions: Record<string, string>) {
  const datasetId = props.datasetId
  improveSaving.value = true
  improveError.value = null
  try {
    if (!prompt.value) await llm.loadPrompt(datasetId)
    const loaded = prompt.value
    if (!loaded || !props.adapter.updateLlmPrompt) {
      improveError.value = promptError.value ?? "Couldn't load your prompt. Try again."
      return
    }
    await llm.savePrompt(datasetId, { template: loaded.template, definitions })
    if (promptError.value) {
      improveError.value = promptError.value
      return
    }
    keepGoing.value = false
    // The new descriptions are the prompt's now; none still wait to be saved.
    if (pendingDescriptions.value) clearPending()
    emit('descriptions', descriptions.value)
  } finally {
    improveSaving.value = false
  }
}

/** Today's panel, inside the step, keeps the guide's step up to date. */
function onPanelState(state: { status: LlmStatus | null; agreement: LlmAgreement | null }) {
  if (state.status) status.value = state.status
  // The panel reads its status before its agreement; a passing null would flip the step.
  if (state.agreement) agreement.value = state.agreement
}

// The workspace keys the guide by Dataset, so a new Dataset mounts a new guide.
onMounted(load)
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
let shownStep: string | null = null
watch([stepView, showing], async ([next, state]) => {
  if (state !== 'ready') return
  const previous = shownStep
  shownStep = next
  if (previous === null || previous === next) return
  await nextTick()
  // On a phone, Show it how folds its heading away: Details takes focus instead.
  if (folded()) detailsToggle.value?.focus()
  else heading.value?.focus()
})
</script>

<template>
  <section
    class="vmlb-guide"
    :class="{ 'is-collapsible': showing === 'ready' && collapsible, 'is-open': detailsOpen }"
    aria-labelledby="vmlb-guide-title"
    :aria-busy="showing === 'loading' ? 'true' : undefined"
  >
    <!-- Phones in Show it how: one line, the six-segment bar and Details. -->
    <div v-if="showing === 'ready' && collapsible" class="vmlb-guide-folded">
      <div class="vmlb-guide-folded-line">
        <p v-if="step === 'try'">Step {{ current + 1 }} of {{ GUIDE_STEPS.length }} · <span class="vmlb-num">Agreed {{ check?.agreed ?? 0 }} of {{ check?.checked ?? 0 }}</span></p>
        <p v-else>Step {{ current + 1 }} of {{ GUIDE_STEPS.length }} · <span class="vmlb-num">{{ targets.total }} of {{ SHOW_TOTAL }} examples</span></p>
        <button
          ref="detailsToggle"
          type="button"
          class="vmlb-guide-details vmlb-guide-target"
          :aria-expanded="detailsOpen ? 'true' : 'false'"
          aria-controls="vmlb-guide-body"
          @click="detailsOpen = !detailsOpen"
        >
          Details
        </button>
      </div>
      <div class="vmlb-guide-segments" aria-hidden="true">
        <span v-for="(s, i) in GUIDE_STEPS" :key="s.key" :class="{ 'is-filled': i <= current }" />
      </div>
    </div>
    <p v-if="showing === 'ready' && step === 'show'" class="vmlb-guide-sr" aria-live="polite">
      {{ targets.total }} of {{ SHOW_TOTAL }} examples labelled.
    </p>

    <div id="vmlb-guide-body" class="vmlb-guide-body">
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
              :class="{ 'is-done': i < current && met[s.key], 'is-skipped': i < current && !met[s.key], 'is-current': i === current }"
              :aria-current="i === current ? 'step' : undefined"
            >
              <span class="vmlb-guide-marker">
                <template v-if="i < current && met[s.key]"><Icon name="check" /><span class="vmlb-guide-sr">Done:</span></template>
                <template v-else-if="i < current"><span class="vmlb-guide-sr">Skipped:</span>{{ i + 1 }}</template>
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

        <div v-if="sentencesError && pendingDescriptions" class="vmlb-guide-sentences-error">
          <p role="alert"><Icon name="alert" /> Your labels are saved, but their sentences aren't saved yet: {{ sentencesError }}</p>
          <button type="button" class="vmlb-btn-secondary vmlb-guide-target" :disabled="syncBusy" :aria-busy="syncBusy" @click="syncDescriptions">{{ syncBusy ? 'Trying again…' : 'Try again' }}</button>
        </div>

        <div class="vmlb-guide-step">
          <h3 ref="heading" class="vmlb-guide-step-title" tabindex="-1">{{ improving ? 'Make your descriptions clearer' : currentStep.title }}</h3>
          <p v-if="currentStep.time && !improving && !(step === 'show' && justConnected)" class="vmlb-guide-time">{{ currentStep.time }}</p>

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
          <GuideConnectStep
            v-else-if="step === 'connect'"
            :adapter="adapter"
            :status="status"
            :has-access="hasAccess"
            :budget-exhausted="budgetExhausted"
            :save-key="connectKey"
            :allow="allowSending"
            @myself="emit('hide')"
          />
          <GuideShowStep
            v-else-if="step === 'show'"
            :targets="targets"
            :holdout="!!currentHoldout"
            :just-connected="justConnected"
          />
          <GuideImproveStep
            v-else-if="step === 'try' && improving && check"
            :labels="labels"
            :agreement="check"
            :disagreements="disagreements"
            :disagreements-failed="disagreementsFailed"
            :descriptions="descriptions"
            :saving="improveSaving"
            :error="improveError"
            @save="saveDescriptions"
            @keep-going="keepGoing = true"
          />
          <p v-else-if="step === 'try'" class="vmlb-guide-text">
            Check the AI against your own labels. Accept its label when it matches yours, or pick your own. Each answer
            counts toward the check.
          </p>
          <!-- Temporary (BAIGLE #193): steps 5–6 show today's AI controls under the
               step title until #196 gives each step its own words and controls. -->
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
    </div>

    <!-- Outside the foldable body: on a phone the suggestion stays above the item. -->
    <GuideTryStep
      v-if="trying"
      :labels="labels"
      :view="tryView"
      :suggestion="trySuggestion"
      :agreement="check"
      :busy="!!busy"
      @accept="answer($event.id)"
      @correct="answer($event.suggestion.id, $event.label)"
      @retry="retrySuggestion"
      @skip="emit('skip')"
    />
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
/* Passed over because nothing was left for it: muted, numbered, no check. */
.is-skipped .vmlb-guide-marker { color: var(--vmlb-text-muted); box-shadow: inset 0 0 0 1px var(--vmlb-border); }
.is-skipped .vmlb-guide-rail-name { color: var(--vmlb-text-muted); }
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
.vmlb-guide-sentences-error { display: flex; flex-wrap: wrap; align-items: center; gap: var(--vmlb-space-sm); margin-bottom: var(--vmlb-space-md); }
.vmlb-guide-sentences-error p { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }

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

.vmlb-guide-folded { display: none; }
.vmlb-guide-folded-line { display: flex; align-items: center; justify-content: space-between; gap: var(--vmlb-space-sm); }
.vmlb-guide-folded-line p { margin: 0; font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-details {
  padding: 0 var(--vmlb-space-2xs); border: 0; background: none; color: var(--vmlb-accent-strong);
  font: inherit; font-size: var(--vmlb-font-size-sm); font-weight: 600;
  text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
}
.vmlb-num { font-variant-numeric: tabular-nums; }

/* Phones: the rail becomes one line over a six-segment bar. */
@media (max-width: 640px) {
  .vmlb-guide { padding: var(--vmlb-space-sm) var(--vmlb-space-md); }
  .vmlb-guide-rail { display: none; }
  .vmlb-guide-compact { display: block; }
  /* Show it how folds to one line, so the item sits above the fold. */
  .vmlb-guide.is-collapsible .vmlb-guide-folded { display: block; }
  .vmlb-guide.is-collapsible .vmlb-guide-compact { display: none; }
  .vmlb-guide.is-collapsible:not(.is-open) .vmlb-guide-body { display: none; }
  .vmlb-guide.is-collapsible.is-open .vmlb-guide-folded { margin-bottom: var(--vmlb-space-sm); }
}
</style>
