<script setup lang="ts">
import { computed } from 'vue'
import { SHOW_PER_LABEL, SHOW_TOTAL, type ShowTargets } from '../annotation/guide'
import Icon from './shared/Icon.vue'

// Step 3, "Show it how": the student labels the first examples the AI learns
// from. The item itself is the workspace's, below the guide. The running count
// is announced by the guide's own live region, which stays out of this text so
// it is heard on phones too, where this text is folded away.

const props = defineProps<{
  targets: ShowTargets
  /** The item on screen is kept aside to test the model. */
  holdout: boolean
  /** Connected in this visit: the step opens with the hand-off line. */
  justConnected: boolean
}>()

const capped = computed(() => props.targets.labels.filter((l) => l.capped && l.count < SHOW_PER_LABEL))
</script>

<template>
  <div class="vmlb-guide-show-step">
    <p v-if="justConnected" class="vmlb-guide-text">
      Connected. Before it suggests anything, show it {{ SHOW_TOTAL }} examples so it learns what you mean. About 5 minutes.
    </p>
    <p v-if="holdout" class="vmlb-guide-holdout">
      This item is kept aside to test your model later. You label these yourself; the AI never sees them.
    </p>
    <p v-else class="vmlb-guide-text">
      Label a few items yourself first. The AI learns what you mean from these: at least {{ SHOW_PER_LABEL }} of each label,
      {{ SHOW_TOTAL }} in total.
    </p>

    <ul v-if="targets.labels.length" class="vmlb-guide-chips" aria-label="Examples so far">
      <li
        v-for="l in targets.labels"
        :key="l.label"
        :class="l.count >= SHOW_PER_LABEL ? 'vmlb-guide-chip' : 'vmlb-guide-chip vmlb-guide-chip-warning'"
      >
        <template v-if="l.count >= SHOW_PER_LABEL"><Icon name="check" /><span class="vmlb-guide-sr">Done:</span></template>
        {{ l.label }} <span class="vmlb-num">{{ l.count }} of {{ SHOW_PER_LABEL }}</span>
      </li>
      <li class="vmlb-guide-chip-total vmlb-num" aria-hidden="true">{{ targets.total }} of {{ SHOW_TOTAL }} labelled</li>
    </ul>
    <p v-else class="vmlb-guide-chip-total vmlb-num" aria-hidden="true">{{ targets.total }} of {{ SHOW_TOTAL }} labelled</p>

    <p v-for="l in capped" :key="l.label" class="vmlb-guide-text">
      Only {{ l.target }} {{ l.label }} rows left. That's enough to continue.
    </p>
  </div>
</template>

<style scoped>
.vmlb-guide-show-step { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-holdout {
  margin: 0; padding: var(--vmlb-space-sm) var(--vmlb-space-md);
  border-radius: var(--vmlb-radius-md); background: var(--vmlb-surface-sunken); color: var(--vmlb-text);
}
.vmlb-guide-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--vmlb-space-xs); margin: 0; padding: 0; list-style: none; }
/* `chip`: a label with enough examples; `chip-warning`: one still under target. */
.vmlb-guide-chip {
  display: inline-flex; align-items: center; gap: var(--vmlb-space-2xs);
  padding: var(--vmlb-space-2xs) var(--vmlb-space-sm); border-radius: 999px;
  background: var(--vmlb-success-soft); color: var(--vmlb-text);
  font-size: var(--vmlb-font-size-xs); font-weight: 600;
}
.vmlb-guide-chip :deep(svg) { color: var(--vmlb-success); }
.vmlb-guide-chip-warning { background: var(--vmlb-warning-soft); }
.vmlb-guide-chip-total { margin: 0; padding: 0 var(--vmlb-space-2xs); color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-xs); }
.vmlb-num { font-variant-numeric: tabular-nums; }
.vmlb-guide-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
</style>
