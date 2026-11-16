<script setup lang="ts">
import { ref } from 'vue'
import { downloadExport } from '../../summarization/exportSummaries'
import type { ExportFormat, SummaryStoreAdapter, SummaryStoreId } from '../../types'
import Icon from '../shared/Icon.vue'

const props = defineProps<{
  store: SummaryStoreAdapter
  taskId: SummaryStoreId
}>()

const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'json', label: 'JSON' },
  { id: 'csv', label: 'CSV' },
]

const format = ref<ExportFormat>('json')
const isExporting = ref(false)
const error = ref<string | null>(null)

async function run() {
  isExporting.value = true
  error.value = null
  try {
    // The store's export when it has one, else the current summaries.
    const rows = props.store.exportSummaries
      ? (await props.store.exportSummaries(props.taskId, format.value)).data
      : await props.store.listSummaries(props.taskId)
    downloadExport(rows, format.value, `summaries_${props.taskId}.${format.value}`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to export.'
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <div class="vmlb-card vmlb-sum-export">
    <h3 class="vmlb-card-title">Export summaries</h3>
    <div class="vmlb-row vmlb-sum-export-row">
      <fieldset class="vmlb-sum-export-format">
        <legend class="vmlb-label">Format</legend>
        <label v-for="f in FORMATS" :key="f.id">
          <input v-model="format" type="radio" name="vmlb-sum-export-format" :value="f.id" /> {{ f.label }}
        </label>
      </fieldset>
      <button type="button" class="vmlb-btn-primary" :disabled="isExporting" @click="run">
        {{ isExporting ? 'Exporting…' : 'Export' }}
      </button>
    </div>
    <div v-if="error" class="vmlb-alert-error vmlb-sum-export-error" role="alert"><Icon name="alert" /> {{ error }}</div>
  </div>
</template>

<style scoped>
.vmlb-sum-export-row { align-items: flex-end; }
.vmlb-sum-export-format { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-md); margin: 0; padding: 0; border: none; }
.vmlb-sum-export-format legend { width: 100%; margin-bottom: var(--vmlb-space-2xs); padding: 0; }
.vmlb-sum-export-format label { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; cursor: pointer; }
.vmlb-sum-export-format input { accent-color: var(--vmlb-accent); }
.vmlb-sum-export-error { margin: var(--vmlb-space-md) 0 0; }
</style>
