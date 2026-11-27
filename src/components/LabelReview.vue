<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AnnotatorView } from 'legal-annotation-kit'
import type { Assignment, Proposal } from 'legal-annotation-kit'
import type { AnnotationAssignment, AnnotationTask, LlmSuggestion, MLAdapter } from '../types'
import { kitLabelset } from '../annotation/labelColours'
import { assignmentChanged, labelSourceText } from '../annotation/review'

// The labels a Dataset already has, from the file, from people or from an LLM,
// one item at a time in row order, to read and change in the kit (BAIGLE #148).
// Moving past an item unchanged saves nothing, so a file label stays the file's.
//
// Given `check`, it goes through those of the AI's labels instead (the guide's
// "Check 10 at random first"). Each is the item's suggestion, never its label,
// until the student accepts or corrects it (BAIGLE ADR 0003); one moved past
// unanswered stays waiting.
const props = defineProps<{
  adapter: MLAdapter
  projectId: string
  datasetId: string
  /** Labels the filter offers; the item's own labels drive the kit. */
  labels: string[]
  /** `single` for single-label types; `multi` otherwise. */
  documentLabelMode: 'single' | 'multi'
  /** The AI's labels to check, one item each. */
  check?: LlmSuggestion[]
}>()

const emit = defineEmits<{ saved: []; close: [] }>()

const filter = ref('')
const index = ref(0)
const total = ref(0)
const task = ref<(Pick<AnnotationTask, 'id'> & { item_index: number | null }) | null>(null)
const opened = ref<AnnotationAssignment | null>(null)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const title = ref<HTMLElement | null>(null)
/** What the student did with each checked suggestion, by its id. */
const answered = ref<Record<string, 'accepted' | 'corrected' | 'rejected'>>({})
const checking = computed(() => !!props.check)
const checked = computed(() => (props.check ? props.check[index.value] ?? null : null))

async function loadCheck() {
  const list = props.check ?? []
  const next = list[index.value] ?? null
  const nextOpened = next ? await props.adapter.getAnnotationAssignment(next.task_id) : null
  total.value = list.length
  task.value = next ? { id: next.task_id, item_index: null } : null
  opened.value = nextOpened
}

/** Why the labels didn't load, in words a student can act on. The adapter's
 * own message when it has one (a 429 says how long to wait), never a bare
 * "Request failed: <code>". */
function loadFailure(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : ''
  if (!message || message.startsWith('Request failed')) return "Couldn't load the labels. Try again."
  return message
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (checking.value) {
      await loadCheck()
      return
    }
    const page = await props.adapter.pageAnnotationTasks!(props.projectId, {
      status: 'annotated',
      datasetId: props.datasetId,
      label: filter.value || undefined,
      includeHoldout: true,
      limit: 1,
      offset: index.value,
    })
    const next = page.tasks[0] ?? null
    const nextOpened = next ? await props.adapter.getAnnotationAssignment(next.id) : null
    // Swap the item and its labels in together: the kit is keyed on the task, so
    // a new task with the old labels would open the next item with them, and a
    // Back or Next would save them onto it.
    total.value = page.total
    task.value = next
    opened.value = nextOpened
  } catch (err) {
    error.value = loadFailure(err)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  // The check opens from the guide: focus goes to its heading.
  if (checking.value) {
    await nextTick()
    title.value?.focus()
  }
})
watch(filter, () => {
  index.value = 0
  notice.value = ''
  load()
})

/** The checked suggestion as the kit's proposal, until it is answered. */
const proposals = computed<Proposal[]>(() => {
  const s = checked.value
  if (!s || answered.value[s.id]) return []
  return [{ id: s.id, kind: 'document', label: s.label, rationale: s.rationale, source: `${s.model} · prompt v${s.prompt_version}` }]
})

/** Accepting confirms the AI's label; another label corrects it. */
async function confirm(suggestion: LlmSuggestion, label?: string) {
  await props.adapter.confirmLlmSuggestion!(suggestion.id, label)
  answered.value = { ...answered.value, [suggestion.id]: label === undefined || label === suggestion.label ? 'accepted' : 'corrected' }
  emit('saved')
}

async function answer(action: () => Promise<void>, done: string) {
  error.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save your answer'
    return
  }
  if (index.value + 1 >= total.value) {
    notice.value = `${done} That was the last one.`
  } else {
    notice.value = done
    index.value += 1
    await load()
  }
  // The answered item's controls are gone with it, the last one's too: focus
  // goes back to the heading, not the page.
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) title.value?.focus()
}

function onProposal(event: { proposal: Proposal; annotation?: { label: string } }, corrected: boolean) {
  const s = checked.value
  if (!s || String(event.proposal.id) !== s.id) return
  const label = corrected ? event.annotation?.label : undefined
  void answer(() => confirm(s, label), label === undefined ? 'Accepted.' : `Changed to ${label}.`)
}

function onProposalRejected(event: { proposal: Proposal }) {
  const s = checked.value
  if (!s || String(event.proposal.id) !== s.id) return
  void answer(async () => {
    await props.adapter.rejectLlmSuggestion!(s.id)
    answered.value = { ...answered.value, [s.id]: 'rejected' }
    emit('saved')
  }, 'Rejected. Label that item yourself later.')
}

/** Saves only a real change; throwing keeps the work in the kit, which says why. */
async function persist(assignment: Assignment) {
  if (checking.value) {
    // A label chosen in the kit, not through the proposal, answers the suggestion too.
    const s = checked.value
    const label = assignment.document_annotations[0]?.label
    if (s && !answered.value[s.id] && label) await confirm(s, label)
    return
  }
  if (!task.value || !opened.value || !assignmentChanged(opened.value.assignment, assignment)) return
  await props.adapter.saveAnnotationAssignment(task.value.id, assignment)
  opened.value = { ...opened.value, assignment, labelSource: 'human' }
  emit('saved')
}

async function onSave(assignment: Assignment) {
  await persist(assignment)
}

async function onNext(assignment: Assignment) {
  await persist(assignment)
  if (index.value + 1 >= total.value) {
    notice.value = 'That was the last one.'
    return
  }
  index.value += 1
  await load()
}

async function onPrevious(assignment: Assignment) {
  await persist(assignment)
  if (index.value === 0) return
  index.value -= 1
  notice.value = ''
  await load()
}

const source = computed(() => labelSourceText(opened.value?.labelSource))
const currentLabels = computed(() => opened.value?.assignment.document_annotations.map((t) => t.label) ?? [])
const fileSaid = computed(() => {
  const file = opened.value?.fileLabel
  if (!file || opened.value?.labelSource === 'file' || opened.value?.annotationLevel !== 'document') return ''
  return currentLabels.value.includes(file) ? '' : file
})
const labelset = computed(() => kitLabelset([...new Set([...(opened.value?.labels ?? []), ...props.labels])]))
</script>

<template>
  <section class="vmlb-review" :aria-label="checking ? 'Check the AI\'s labels' : 'Review labels'">
    <div class="vmlb-review-head">
      <h2 ref="title" class="vmlb-review-title" tabindex="-1">{{ checking ? `Check ${total} of the AI's labels` : 'Review labels' }}</h2>
      <label v-if="!checking" class="vmlb-review-filter">
        <span class="vmlb-label">Show</span>
        <select v-model="filter" aria-label="Show labels">
          <option value="">All labels</option>
          <option v-for="label in labels" :key="label" :value="label">{{ label }}</option>
        </select>
      </label>
      <button class="vmlb-btn-tertiary vmlb-review-back" @click="emit('close')">{{ checking ? 'Back to the guide' : 'Back to the queue' }}</button>
    </div>
    <p v-if="checking" class="vmlb-muted vmlb-review-intro">
      Picked at random from the AI's labels. Accept each one that's right, or choose the right label. None becomes a label
      until you accept it; one you move past keeps waiting.
    </p>
    <p v-else class="vmlb-muted vmlb-review-intro">
      Change a label and Save, or move on with Next. Only what you change is saved, as your label.
    </p>

    <div v-if="error" class="vmlb-alert-error">{{ error }}</div>
    <p v-else-if="!loading && !task && checking" class="vmlb-muted">The AI has no labels waiting to check.</p>
    <p v-else-if="!loading && !task" class="vmlb-muted">No labelled items{{ filter ? ` with ${filter}` : '' }}.</p>

    <template v-if="task && opened">
      <p class="vmlb-review-source">
        <span v-if="checking && checked && answered[checked.id]" class="vmlb-badge">{{ { accepted: 'You accepted the AI\'s label', corrected: 'You changed the AI\'s label', rejected: 'You rejected the AI\'s label' }[answered[checked.id]] }}</span>
        <span v-else-if="checking" class="vmlb-badge">The AI's label, not accepted yet</span>
        <span v-else-if="source" class="vmlb-badge">{{ source }}</span>
        <span v-if="fileSaid" class="vmlb-muted">The file said: {{ fileSaid }}</span>
        <span v-if="task.item_index !== null" class="vmlb-muted">Row {{ task.item_index + 1 }} of the Dataset</span>
      </p>
      <div class="vmlb-kit">
        <AnnotatorView
          :key="task.id"
          :document="opened.document"
          :assignment="opened.assignment"
          :labelset="labelset"
          :annotation-level="opened.annotationLevel ?? 'document'"
          :position="{ current: index + 1, total }"
          :navigation="true"
          :draft="false"
          :show-relations="false"
          :show-confidence="false"
          :show-metadata="false"
          :document-label-mode="documentLabelMode"
          :allow-overlap="opened.annotationLevel === 'document'"
          :on-save="onSave"
          :on-next="onNext"
          :on-previous="onPrevious"
          :proposals="proposals"
          @proposal-accepted="onProposal($event, false)"
          @proposal-corrected="onProposal($event, true)"
          @proposal-rejected="onProposalRejected"
        />
      </div>
    </template>
    <!-- Mounted from the start, so a notice put in it is announced. -->
    <p role="status" class="vmlb-muted vmlb-review-notice" :class="{ 'is-empty': !notice }">{{ notice }}</p>
  </section>
</template>

<style scoped>
.vmlb-review { margin-top: 1rem; }
.vmlb-review-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem; }
.vmlb-review-title { margin: 0; font-size: var(--vmlb-font-size-lg); }
.vmlb-review-title:focus { outline: none; }
.vmlb-review-title:focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-review-back { min-height: 2.75rem; }
.vmlb-review-filter { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
.vmlb-review-filter select {
  padding: 0.3rem 0.5rem; border: 1px solid var(--vmlb-border); border-radius: var(--vmlb-radius-sm);
  background: var(--vmlb-surface); color: var(--vmlb-text); font: inherit; font-size: var(--vmlb-font-size-md);
}
.vmlb-review-intro { margin: 0.5rem 0 1rem; font-size: var(--vmlb-font-size-md); }
.vmlb-review-source { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin: 0 0 0.5rem; font-size: var(--vmlb-font-size-sm); }
.vmlb-review-notice { margin-top: 0.5rem; font-size: var(--vmlb-font-size-md); }
.vmlb-review-notice.is-empty { margin: 0; }
</style>
