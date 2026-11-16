<script setup lang="ts">
import type { SummaryResult } from '../../types'

defineProps<{
  results: SummaryResult[]
  /** Shows "Save summary" on each result. */
  allowSave?: boolean
}>()

const emit = defineEmits<{
  /** Only with `allowSave`, when the user saves a result. */
  save: [result: SummaryResult]
}>()
</script>

<template>
  <div v-if="results.length" class="vmlb-sum-results">
    <article v-for="result in results" :key="result.request_id" class="vmlb-card vmlb-sum-result">
      <h3 v-if="result.document" class="vmlb-card-title">{{ result.document.name }}</h3>
      <p class="vmlb-sum-text">{{ result.summarized_text }}</p>
      <div v-if="allowSave" class="vmlb-actions">
        <button type="button" class="vmlb-btn-secondary" @click="emit('save', result)">Save summary</button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.vmlb-sum-results { display: flex; flex-direction: column; gap: var(--vmlb-space-md); margin-top: var(--vmlb-space-lg); }
.vmlb-sum-result { border-left: 3px solid var(--vmlb-accent); }
.vmlb-card + .vmlb-card { margin-top: 0; }
.vmlb-sum-text { margin: 0; white-space: pre-wrap; line-height: 1.6; max-width: 72ch; }
</style>
