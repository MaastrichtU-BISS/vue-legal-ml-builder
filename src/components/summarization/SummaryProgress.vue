<script setup lang="ts">
import { computed } from 'vue'
import { SUMMARY_STATUS_LABEL } from '../../summarization/summaryDisplay'
import type { SummarizationJobStatus } from '../../types'

const props = defineProps<{
  /** 0..100 */
  progress: number
  status?: SummarizationJobStatus | null
  batchCompleted?: number
  batchTotal?: number
}>()

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.progress))))
const isBatch = computed(() => (props.batchTotal ?? 0) > 1)
const label = computed(() => (props.status ? SUMMARY_STATUS_LABEL[props.status] : 'Sending'))
</script>

<template>
  <div class="vmlb-sum-progress" role="status" aria-live="polite">
    <div class="vmlb-row">
      <span class="vmlb-label">{{ label }}</span>
      <span class="vmlb-num vmlb-muted">
        <template v-if="isBatch">{{ batchCompleted ?? 0 }} / {{ batchTotal }} documents</template>
        <template v-else>{{ pct }}%</template>
      </span>
    </div>
    <div class="vmlb-sum-track">
      <div class="vmlb-sum-fill" role="progressbar" :style="{ width: `${pct}%` }" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" />
    </div>
  </div>
</template>

<style scoped>
.vmlb-sum-progress { display: flex; flex-direction: column; gap: 0.375rem; margin-top: var(--vmlb-space-md); }
.vmlb-sum-track { height: 0.375rem; border-radius: 999px; background: var(--vmlb-surface-sunken); overflow: hidden; }
.vmlb-sum-fill { height: 100%; border-radius: inherit; background: var(--vmlb-accent); transition: width var(--vmlb-duration) var(--vmlb-ease); }
</style>
