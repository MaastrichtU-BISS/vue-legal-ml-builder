<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Disagreement } from '../annotation/guide'
import type { LlmAgreement } from '../types'
import Icon from './shared/Icon.vue'

// Step 4's improving state: the server's full sample is checked and the AI
// agreed too rarely. The student sees where the two disagreed and rewrites
// their label descriptions; saving them is a new prompt version, which starts
// the check again. Keeping going one item at a time never unlocks bulk accept.

const props = defineProps<{
  labels: string[]
  agreement: LlmAgreement
  /** Null while they load. */
  disagreements: Disagreement[] | null
  disagreementsFailed: boolean
  /** Each label's description as the prompt has it now. */
  descriptions: Record<string, string>
  saving: boolean
  /** Why the descriptions weren't saved, in the server's words. */
  error: string | null
}>()
const emit = defineEmits<{
  (e: 'save', definitions: Record<string, string>): void
  (e: 'keep-going'): void
}>()

const draft = ref<Record<string, string>>({})
/** Labels the student has typed in: a description arriving later leaves these alone. */
const edited = new Set<string>()
watch(
  () => [props.labels, props.descriptions] as const,
  ([labels, descriptions]) => {
    draft.value = Object.fromEntries(
      labels.map((label) => [label, edited.has(label) ? draft.value[label] ?? '' : descriptions[label] ?? '']),
    )
  },
  { immediate: true },
)

const percent = (share: number) => `${Math.round(share * 100)}%`

function save() {
  const filled = Object.entries(draft.value)
    .map(([label, text]) => [label, text.trim()] as const)
    .filter(([, text]) => text)
  emit('save', Object.fromEntries(filled))
}
</script>

<template>
  <div class="vmlb-guide-improve">
    <p class="vmlb-guide-text">
      The AI agreed with you on {{ agreement.agreed }} of {{ agreement.checked }}
      ({{ percent(agreement.rate ?? 0) }}). It needs {{ percent(agreement.threshold) }} before it can label the rest.
      Clearer descriptions of your labels usually help.
    </p>

    <h4 class="vmlb-guide-subtitle">Where you disagreed</h4>
    <p v-if="disagreementsFailed" class="vmlb-guide-text vmlb-guide-muted">Couldn't load the items you disagreed on.</p>
    <p v-else-if="disagreements === null" class="vmlb-guide-text vmlb-guide-muted" role="status">Loading the items you disagreed on…</p>
    <p v-else-if="!disagreements.length" class="vmlb-guide-text vmlb-guide-muted">No disagreements to show.</p>
    <ul v-else class="vmlb-guide-disagreements">
      <li v-for="d in disagreements" :key="d.id">
        <p class="vmlb-guide-disagreement-text">{{ d.text }}</p>
        <p class="vmlb-guide-disagreement-labels">
          <span>Your label: <strong>{{ d.yours }}</strong></span>
          <span>The AI's label: <strong>{{ d.ai }}</strong></span>
        </p>
      </li>
    </ul>

    <form class="vmlb-guide-improve-form" @submit.prevent="save">
      <div v-for="label in labels" :key="label" class="vmlb-guide-improve-field">
        <label :for="`vmlb-guide-describe-${label}`">What {{ label }} means</label>
        <textarea
          :id="`vmlb-guide-describe-${label}`"
          v-model="draft[label]"
          @input="edited.add(label)"
          :name="`description-${label}`"
          rows="2"
          maxlength="500"
        />
      </div>
      <p class="vmlb-guide-text">Saving starts the check again with your new descriptions.</p>
      <p v-if="error" class="vmlb-guide-improve-error" role="alert"><Icon name="alert" /> {{ error }}</p>
      <div class="vmlb-guide-improve-actions">
        <button type="submit" class="vmlb-btn-primary vmlb-guide-target" :disabled="saving" :aria-busy="saving">
          {{ saving ? 'Saving…' : 'Save descriptions' }}
        </button>
        <button type="button" class="vmlb-btn-secondary vmlb-guide-target" :disabled="saving" @click="emit('keep-going')">
          Keep going one item at a time
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.vmlb-guide-improve { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-muted { color: var(--vmlb-text-muted); }
.vmlb-guide-subtitle { margin: var(--vmlb-space-xs) 0 0; font-size: var(--vmlb-font-size-md); font-weight: 600; }
.vmlb-guide-disagreements {
  display: flex; flex-direction: column; gap: var(--vmlb-space-xs);
  max-height: 20rem; overflow-y: auto; margin: 0; padding: 0; list-style: none;
}
.vmlb-guide-disagreements li {
  padding: var(--vmlb-space-xs) var(--vmlb-space-sm);
  border-radius: var(--vmlb-radius-md); background: var(--vmlb-surface);
}
.vmlb-guide-disagreements p { margin: 0; }
.vmlb-guide-disagreement-text {
  display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.vmlb-guide-disagreement-labels {
  display: flex; flex-wrap: wrap; gap: var(--vmlb-space-2xs) var(--vmlb-space-md);
  margin-top: var(--vmlb-space-2xs) !important; color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm);
}
.vmlb-guide-disagreement-labels strong { color: var(--vmlb-text); }
.vmlb-guide-improve-form { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-improve-field { display: flex; flex-direction: column; gap: var(--vmlb-space-2xs); }
.vmlb-guide-improve-field label { font-weight: 600; font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-improve-field textarea {
  padding: var(--vmlb-space-xs) var(--vmlb-space-sm);
  border: 1px solid var(--vmlb-border-strong); border-radius: var(--vmlb-radius-sm);
  background: var(--vmlb-surface); color: var(--vmlb-text);
  font: inherit; font-size: var(--vmlb-font-size-sm);
}
.vmlb-guide-improve-field textarea:focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-guide-improve-error { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }
.vmlb-guide-improve-actions { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-xs); }
.vmlb-guide-target { min-height: 2.75rem; }
</style>
