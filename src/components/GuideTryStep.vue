<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { agreementLine, type TryView } from '../annotation/guide'
import type { LlmAgreement, LlmSuggestion } from '../types'
import Icon from './shared/Icon.vue'

// Step 4, "Try it": the AI's suggestion for the item below, and how often it
// has agreed with the student so far. A suggestion is never a label until the
// student accepts it or picks their own (BAIGLE ADR 0003). This card sits
// outside the guide's foldable body, so on a phone it stays above the item.

const props = defineProps<{
  labels: string[]
  view: TryView
  suggestion: LlmSuggestion | null
  /** The check for the prompt version and model in use. */
  agreement: LlmAgreement | null
  /** A label is being saved. */
  busy: boolean
  /** Why the last request failed, when the AI provider limited it: its own words. */
  failure?: string | null
}>()
const emit = defineEmits<{
  (e: 'accept', suggestion: LlmSuggestion): void
  (e: 'correct', answer: { suggestion: LlmSuggestion; label: string }): void
  (e: 'retry'): void
  (e: 'skip'): void
}>()

const others = computed(() => (props.suggestion ? props.labels.filter((label) => label !== props.suggestion!.label) : []))
const count = computed(() => agreementLine(props.agreement))
const showsCard = computed(() => props.view === 'ready' && !!props.suggestion)
/** The ready card's rows, held invisibly behind every other state. The
 * longest label stands in for the suggested one, so a long suggestion's
 * Accept button never needs more room than was held. */
const placeholder = computed(() => {
  const label = props.labels.reduce((longest, l) => (l.length > longest.length ? l : longest), '')
  // Every label in the "Pick your label" row: the real row is always some of
  // them, so it never wraps onto more lines than were held.
  return { label, others: props.labels }
})

const root = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
/** The student answered from the card: the next suggestion takes focus, so the
 * keyboard flow carries on from item to item. */
let refocus = false

function accept() {
  if (!props.suggestion || props.busy) return
  refocus = true
  emit('accept', props.suggestion)
}

function correct(label: string) {
  if (!props.suggestion || props.busy) return
  refocus = true
  emit('correct', { suggestion: props.suggestion, label })
}

function skip() {
  refocus = true
  emit('skip')
}

/** S on the card skips here, not through the workspace's own S, so the next
 * suggestion takes focus as it does after the Skip button. */
function onKeydown(event: KeyboardEvent) {
  if (!showsCard.value || event.key.toLowerCase() !== 's') return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  event.preventDefault()
  event.stopPropagation()
  if (!props.busy) skip()
}

watch(
  () => props.suggestion?.id,
  async (id) => {
    if (!id || !refocus) return
    refocus = false
    await nextTick()
    // Only if focus is still on the card's way out, not somewhere the student moved it.
    const active = document.activeElement
    if (active && active !== document.body && !root.value?.contains(active)) return
    card.value?.focus()
  },
)
</script>

<template>
  <div ref="root" class="vmlb-guide-try" @keydown="onKeydown">
    <!-- One box for every state, so "Asking the AI…" and the suggestion take the same room. -->
    <div v-if="view !== 'idle'" class="vmlb-guide-suggestion">
      <!-- The card's rows, held invisibly under every state, the card too, so the box is always the larger of the two. -->
      <div class="vmlb-guide-suggested vmlb-guide-placeholder" aria-hidden="true">
        <p class="vmlb-guide-suggested-label"><Icon name="spark" /> The AI suggests <strong>{{ placeholder.label }}</strong></p>
        <p class="vmlb-guide-reason">&nbsp;<br />&nbsp;</p>
        <div class="vmlb-guide-try-actions">
          <span class="vmlb-btn-primary vmlb-guide-target">Accept {{ placeholder.label }}</span>
          <span class="vmlb-btn-tertiary vmlb-guide-target">Skip</span>
        </div>
        <div v-if="placeholder.others.length" class="vmlb-guide-try-others">
          <p>Not right? Pick your label:</p>
          <span v-for="label in placeholder.others" :key="label" class="vmlb-btn-secondary vmlb-guide-target">{{ label }}</span>
        </div>
      </div>

      <p v-if="view === 'holdout'" class="vmlb-guide-try-holdout">
        This item is kept aside to test your model later. You label these yourself; the AI never sees them.
      </p>

      <p v-else-if="view === 'asking'" class="vmlb-guide-asking" role="status">
        <span class="vmlb-guide-pulse" aria-hidden="true" /> Asking the AI…
      </p>

      <div v-else-if="view === 'failed'" class="vmlb-guide-try-failed">
        <template v-if="failure">
          <p role="alert"><Icon name="alert" /> {{ failure }}</p>
          <p class="vmlb-guide-text">Label this one yourself, or try again later.</p>
        </template>
        <p v-else role="alert"><Icon name="alert" /> The AI didn't answer. Label this one yourself, or try again.</p>
        <button type="button" class="vmlb-btn-secondary vmlb-guide-target" @click="emit('retry')">Try again</button>
      </div>

      <p v-else-if="view === 'invalid'" class="vmlb-guide-text" role="status">
        Skipped: the AI's answer wasn't one of your labels. Label this one yourself.
      </p>

      <p v-else-if="view === 'answered'" class="vmlb-guide-text">The AI has no suggestion for this item. Label it yourself.</p>

      <div
        v-else-if="showsCard && suggestion"
        ref="card"
        class="vmlb-guide-suggested"
        tabindex="0"
        role="group"
        aria-label="The AI's suggestion"
        aria-keyshortcuts="Enter S"
        @keydown.enter.self.prevent="accept"
      >
        <p class="vmlb-guide-suggested-label"><Icon name="spark" /> The AI suggests <strong>{{ suggestion.label }}</strong></p>
        <p class="vmlb-guide-reason">{{ suggestion.rationale }}</p>
        <div class="vmlb-guide-try-actions">
          <button type="button" class="vmlb-btn-primary vmlb-guide-target" :disabled="busy" @click="accept">Accept {{ suggestion.label }}</button>
          <button type="button" class="vmlb-btn-tertiary vmlb-guide-target" :disabled="busy" title="Skip this item (S key)" @click="skip">Skip</button>
        </div>
        <div v-if="others.length" class="vmlb-guide-try-others" role="group" aria-labelledby="vmlb-guide-try-others">
          <p id="vmlb-guide-try-others">Not right? Pick your label:</p>
          <button
            v-for="label in others"
            :key="label"
            type="button"
            class="vmlb-btn-secondary vmlb-guide-target"
            :disabled="busy"
            @click="correct(label)"
          >
            {{ label }}
          </button>
        </div>
      </div>
    </div>

    <!-- The guide's own live region announces the count; this is what is seen. -->
    <p class="vmlb-guide-count vmlb-num">{{ count }}</p>
    <!-- Always there, so the suggestion arriving moves nothing below it. -->
    <p class="vmlb-guide-keys" :class="{ 'is-hidden': !showsCard }" :aria-hidden="showsCard ? undefined : 'true'">Press <kbd>Enter</kbd> on the suggestion to accept it, <kbd>S</kbd> to skip.</p>
  </div>
</template>

<style scoped>
.vmlb-guide-try { display: flex; flex-direction: column; gap: var(--vmlb-space-xs); margin-top: var(--vmlb-space-sm); }
/* Room for a suggestion in every state, so nothing below moves when it arrives:
   each state sits in the one grid cell over the card's invisible placeholder. */
.vmlb-guide-suggestion {
  display: grid; min-height: 9rem; padding: var(--vmlb-space-sm) var(--vmlb-space-md);
  border-radius: var(--vmlb-radius-md); background: var(--vmlb-surface); color: var(--vmlb-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vmlb-accent) 22%, var(--vmlb-surface));
}
.vmlb-guide-suggestion > * { grid-area: 1 / 1; min-width: 0; }
.vmlb-guide-suggestion p { margin: 0; }
.vmlb-guide-placeholder { visibility: hidden; pointer-events: none; }
.vmlb-guide-suggestion > :not(.vmlb-guide-placeholder) { align-self: start; }
.vmlb-guide-keys.is-hidden { visibility: hidden; }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-try-holdout { color: var(--vmlb-text); }
.vmlb-guide-asking { display: flex; align-items: center; gap: var(--vmlb-space-xs); min-height: 2.75rem; color: var(--vmlb-text-muted); }
.vmlb-guide-pulse {
  width: 0.625rem; height: 0.625rem; border-radius: 999px; background: var(--vmlb-accent);
  animation: vmlb-guide-pulse 1.2s ease-in-out infinite;
}
@keyframes vmlb-guide-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .vmlb-guide-pulse { animation: none; } }
.vmlb-guide-try-failed { display: flex; flex-direction: column; align-items: flex-start; gap: var(--vmlb-space-sm); }
.vmlb-guide-try-failed p { display: flex; align-items: center; gap: var(--vmlb-space-xs); color: var(--vmlb-error); }
.vmlb-guide-suggested { display: flex; flex-direction: column; gap: var(--vmlb-space-xs); border-radius: var(--vmlb-radius-sm); }
.vmlb-guide-suggested:focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 4px; }
.vmlb-guide-suggested-label { display: flex; align-items: center; gap: var(--vmlb-space-xs); font-size: var(--vmlb-font-size-base); }
.vmlb-guide-suggested-label :deep(svg) { color: var(--vmlb-accent); }
/* Two lines held for the one-sentence reason, as the placeholder holds, so a short reason doesn't shrink the box. */
.vmlb-guide-reason { min-height: 2lh; color: var(--vmlb-text-muted); }
.vmlb-guide-try-actions, .vmlb-guide-try-others { display: flex; flex-wrap: wrap; align-items: center; gap: var(--vmlb-space-xs); }
.vmlb-guide-try-others p { width: 100%; font-size: var(--vmlb-font-size-sm); color: var(--vmlb-text-muted); }
.vmlb-guide-target { min-height: 2.75rem; }
.vmlb-guide-try :focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-guide-count { margin: 0; font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-keys { margin: 0; color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-xs); }
.vmlb-guide-keys kbd { padding: 0 var(--vmlb-space-2xs); border: 1px solid var(--vmlb-border-strong); border-radius: var(--vmlb-radius-sm); font-family: var(--vmlb-font-mono, monospace); }
.vmlb-num { font-variant-numeric: tabular-nums; }
</style>
