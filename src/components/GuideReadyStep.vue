<script setup lang="ts">
import { computed } from 'vue'
import { READY_WARN_BELOW, type ReadySummary } from '../annotation/guide'
import Icon from './shared/Icon.vue'

// Step 6, "Ready to train": the confirmed examples per label, a named warning
// for any label under READY_WARN_BELOW, and the hand-off to Create model,
// blocked while a label has none.

const props = defineProps<{
  summary: ReadySummary
  /** Where Create model opens; the workspace's `createModelHref`. */
  createModelHref?: string
}>()

const quoted = (label: string) => `“${label}”`
const blockedReason = computed(() => {
  const none = props.summary.none
  if (!none.length) return ''
  const names = none.length === 1 ? quoted(none[0]) : `${none.slice(0, -1).map(quoted).join(', ')} and ${quoted(none[none.length - 1])}`
  return `A model needs at least one example of every label. ${names} ${none.length === 1 ? 'has' : 'have'} none yet, so Create model can't start.`
})
</script>

<template>
  <div class="vmlb-guide-ready">
    <p class="vmlb-guide-text">Your labels are ready. Here is how many examples each label has:</p>
    <ul v-if="summary.labels.length" class="vmlb-guide-counts" aria-label="Examples per label">
      <li v-for="l in summary.labels" :key="l.label">
        <span>{{ l.label }}</span> <span class="vmlb-num">{{ l.count }}</span>
      </li>
    </ul>

    <p v-for="l in summary.few" :key="l.label" class="vmlb-guide-warning">
      <Icon name="alert" />
      <span>Only {{ l.count }} {{ quoted(l.label) }} {{ l.count === 1 ? 'example' : 'examples' }}. Your model may miss this label; {{ READY_WARN_BELOW }} or more works better.</span>
    </p>

    <div class="vmlb-guide-actions">
      <template v-if="blockedReason">
        <button type="button" class="vmlb-btn-primary vmlb-guide-target" disabled aria-describedby="vmlb-guide-ready-blocked">Create model</button>
      </template>
      <a v-else-if="createModelHref" :href="createModelHref" class="vmlb-btn-primary vmlb-guide-target">Create model</a>
    </div>
    <p v-if="blockedReason" id="vmlb-guide-ready-blocked" class="vmlb-guide-error">
      <Icon name="alert" /> {{ blockedReason }}
    </p>
    <p v-else-if="!createModelHref" class="vmlb-guide-text">Create a model from your project to train it.</p>
  </div>
</template>

<style scoped>
.vmlb-guide-ready { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-counts { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-xs); margin: 0; padding: 0; list-style: none; }
.vmlb-guide-counts li {
  display: inline-flex; align-items: center; gap: var(--vmlb-space-xs);
  padding: var(--vmlb-space-2xs) var(--vmlb-space-sm); border-radius: 999px;
  background: var(--vmlb-surface); box-shadow: inset 0 0 0 1px var(--vmlb-border);
  font-size: var(--vmlb-font-size-sm);
}
.vmlb-guide-counts li span:first-child { font-weight: 600; }
.vmlb-guide-warning {
  display: flex; align-items: flex-start; gap: var(--vmlb-space-xs); margin: 0;
  padding: var(--vmlb-space-sm) var(--vmlb-space-md); border-radius: var(--vmlb-radius-md);
  background: var(--vmlb-warning-soft); color: var(--vmlb-text);
}
.vmlb-guide-warning :deep(svg) { flex-shrink: 0; margin-top: 0.15rem; }
.vmlb-guide-actions { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-sm); }
.vmlb-guide-target { display: inline-flex; align-items: center; min-height: 2.75rem; }
.vmlb-guide-ready :focus-visible { outline: 2px solid var(--vmlb-accent); outline-offset: 2px; }
.vmlb-guide-error { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }
.vmlb-num { font-variant-numeric: tabular-nums; }
</style>
