<script setup lang="ts">
import { ref, watch } from 'vue'
import { formatSummaryDate, sourceBadgeClass } from '../../summarization/summaryDisplay'
import type { PersistedSummary, SummaryDocument, SummaryStoreAdapter, SummaryStoreId } from '../../types'
import Icon from '../shared/Icon.vue'
import SummaryVersionHistory from './SummaryVersionHistory.vue'

const props = defineProps<{
  store: SummaryStoreAdapter
  taskId: SummaryStoreId
  /** Names documents whose summaries carry no `document_name`. */
  documents?: SummaryDocument[]
}>()

const emit = defineEmits<{ 'summary-updated': [] }>()

const summaries = ref<PersistedSummary[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const rejecting = ref<PersistedSummary | null>(null)
const reason = ref('')
const isRejecting = ref(false)
const expandedDoc = ref<string | null>(null)

function documentName(summary: PersistedSummary): string {
  if (summary.document_name) return summary.document_name
  const match = props.documents?.find((d) => String(d.id) === String(summary.document_id))
  return match?.name ?? `Document ${summary.document_id}`
}

async function load() {
  isLoading.value = true
  error.value = null
  try {
    summaries.value = await props.store.listSummaries(props.taskId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load the summaries.'
  } finally {
    isLoading.value = false
  }
}

function openReject(summary: PersistedSummary) {
  rejecting.value = summary
  reason.value = ''
}

async function confirmReject() {
  if (!rejecting.value) return
  isRejecting.value = true
  error.value = null
  try {
    await props.store.rejectSummary(rejecting.value.id, reason.value || undefined)
    rejecting.value = null
    await load()
    emit('summary-updated')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to reject the summary.'
  } finally {
    isRejecting.value = false
  }
}

function toggleHistory(documentId: SummaryStoreId) {
  expandedDoc.value = expandedDoc.value === String(documentId) ? null : String(documentId)
}

function onVersionRejected() {
  void load()
  emit('summary-updated')
}

watch(() => props.taskId, load, { immediate: true })

defineExpose({ reload: load })
</script>

<template>
  <div class="vmlb-sum-stored">
    <div v-if="isLoading && !summaries.length" class="vmlb-sum-loading">
      <div class="vmlb-skeleton vmlb-skeleton-tile" />
      <div class="vmlb-skeleton vmlb-skeleton-tile" />
    </div>

    <div v-else-if="!summaries.length && !error" class="vmlb-card vmlb-empty">
      <p class="vmlb-empty-title">No summaries yet</p>
      <p>Summaries generated for this task appear here.</p>
    </div>

    <article v-for="summary in summaries" :key="String(summary.id)" class="vmlb-card">
      <div class="vmlb-tile-head">
        <div>
          <h3>{{ documentName(summary) }}</h3>
          <div class="vmlb-sum-tags">
            <span class="vmlb-status" :class="sourceBadgeClass(summary.generation_source)">{{ summary.generation_source }}</span>
            <span v-if="summary.from_cache" class="vmlb-badge">From cache</span>
          </div>
        </div>
        <button type="button" class="vmlb-icon-btn" title="Reject and regenerate" aria-label="Reject summary" @click="openReject(summary)">
          <Icon name="close" />
        </button>
      </div>

      <p class="vmlb-sum-text">{{ summary.summary_text }}</p>

      <div class="vmlb-row vmlb-sum-foot">
        <span class="vmlb-muted vmlb-small">{{ formatSummaryDate(summary.created_at) }}</span>
        <button type="button" class="vmlb-link-btn" @click="toggleHistory(summary.document_id)">
          {{ expandedDoc === String(summary.document_id) ? 'Hide history' : 'View history' }}
        </button>
      </div>

      <SummaryVersionHistory
        v-if="expandedDoc === String(summary.document_id)"
        :store="store"
        :task-id="taskId"
        :document-id="summary.document_id"
        @version-rejected="onVersionRejected"
      />
    </article>

    <div v-if="error" class="vmlb-alert-error" role="alert"><Icon name="alert" /> {{ error }}</div>

    <div v-if="rejecting" class="vmlb-modal-backdrop" @click.self="rejecting = null">
      <div class="vmlb-modal" role="dialog" aria-modal="true" aria-labelledby="vmlb-sum-reject">
        <div class="vmlb-modal-head">
          <h3 id="vmlb-sum-reject">Reject this summary?</h3>
          <button type="button" class="vmlb-icon-btn" aria-label="Close" @click="rejecting = null"><Icon name="close" /></button>
        </div>
        <p class="vmlb-muted">A new summary is generated to replace it.</p>
        <div class="vmlb-field">
          <label for="vmlb-sum-reason">Reason (optional)</label>
          <textarea id="vmlb-sum-reason" v-model="reason" rows="4" placeholder="What is wrong with this summary?" />
        </div>
        <div class="vmlb-actions">
          <button type="button" class="vmlb-btn-secondary" @click="rejecting = null">Cancel</button>
          <button type="button" class="vmlb-btn-primary" :disabled="isRejecting" @click="confirmReject">
            {{ isRejecting ? 'Regenerating…' : 'Reject and regenerate' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vmlb-field input, .vmlb-field select, .vmlb-field textarea { box-sizing: border-box; }
.vmlb-sum-stored { display: flex; flex-direction: column; gap: var(--vmlb-space-md); }
.vmlb-sum-stored .vmlb-card + .vmlb-card { margin-top: 0; }
.vmlb-sum-loading { display: flex; flex-direction: column; gap: var(--vmlb-space-md); }
.vmlb-tile-head h3 { margin: 0 0 0.375rem; font-family: var(--vmlb-font-display); font-size: var(--vmlb-font-size-lg); font-weight: 600; }
.vmlb-sum-tags { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.vmlb-sum-text { margin: 0; white-space: pre-wrap; line-height: 1.6; max-width: 72ch; }
.vmlb-sum-foot { align-items: center; margin-top: var(--vmlb-space-sm); }
.vmlb-modal .vmlb-muted { margin: 0 0 var(--vmlb-space-md); }
</style>
