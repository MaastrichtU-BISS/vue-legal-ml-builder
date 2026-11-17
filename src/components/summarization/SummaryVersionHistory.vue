<script setup lang="ts">
import { ref, watch } from 'vue'
import { formatSummaryDate, sourceBadgeClass } from '../../summarization/summaryDisplay'
import type { PersistedSummary, SummaryStoreAdapter, SummaryStoreId } from '../../types'
import Icon from '../shared/Icon.vue'

const props = defineProps<{
  store: SummaryStoreAdapter
  taskId: SummaryStoreId
  documentId: SummaryStoreId
}>()

const emit = defineEmits<{
  /** A version was rejected; carries its regenerated replacement. */
  'version-rejected': [replacement: PersistedSummary]
}>()

const versions = ref<PersistedSummary[]>([])
const isLoading = ref(false)
const isRejecting = ref(false)
const rejecting = ref<PersistedSummary | null>(null)
const reason = ref('')
const error = ref<string | null>(null)

async function load() {
  isLoading.value = true
  error.value = null
  try {
    versions.value = await props.store.getVersionHistory(props.taskId, props.documentId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load the version history.'
  } finally {
    isLoading.value = false
  }
}

function openReject(version: PersistedSummary) {
  rejecting.value = version
  reason.value = ''
}

async function confirmReject() {
  if (!rejecting.value) return
  isRejecting.value = true
  error.value = null
  try {
    const replacement = await props.store.rejectSummary(rejecting.value.id, reason.value || undefined)
    rejecting.value = null
    emit('version-rejected', replacement)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to reject the version.'
  } finally {
    isRejecting.value = false
  }
}

watch(() => [props.taskId, props.documentId], load, { immediate: true })
</script>

<template>
  <div class="vmlb-sum-history">
    <p v-if="isLoading && !versions.length" class="vmlb-muted">Loading the history…</p>
    <p v-else-if="!versions.length" class="vmlb-muted">No versions yet.</p>

    <ol v-else class="vmlb-sum-timeline">
      <li v-for="version in versions" :key="String(version.id)" :class="{ rejected: version.rejected_at }">
        <div class="vmlb-row">
          <strong class="vmlb-num">
            v{{ version.version_number ?? '?' }}
            <span class="vmlb-muted vmlb-small">{{ formatSummaryDate(version.created_at) }}</span>
          </strong>
          <span>
            <span v-if="version.from_cache" class="vmlb-badge">From cache</span>
            <span class="vmlb-status" :class="sourceBadgeClass(version.generation_source)">{{ version.generation_source }}</span>
          </span>
        </div>
        <p class="vmlb-sum-text">{{ version.summary_text }}</p>
        <p v-if="version.rejected_at" class="vmlb-sum-rejected">
          <strong>Rejected</strong><span v-if="version.rejection_reason">: {{ version.rejection_reason }}</span>
        </p>
        <div v-else class="vmlb-sum-end">
          <button type="button" class="vmlb-btn-tertiary vmlb-sum-danger" @click="openReject(version)">Reject</button>
        </div>
      </li>
    </ol>

    <div v-if="error" class="vmlb-alert-error" role="alert"><Icon name="alert" /> {{ error }}</div>

    <div v-if="rejecting" class="vmlb-modal-backdrop" @click.self="rejecting = null">
      <div class="vmlb-modal" role="dialog" aria-modal="true" aria-labelledby="vmlb-sum-reject-version">
        <div class="vmlb-modal-head">
          <h3 id="vmlb-sum-reject-version">Reject this version?</h3>
          <button type="button" class="vmlb-icon-btn" aria-label="Close" @click="rejecting = null"><Icon name="close" /></button>
        </div>
        <p class="vmlb-muted">A new summary is generated to replace it.</p>
        <div class="vmlb-field">
          <label for="vmlb-sum-version-reason">Reason (optional)</label>
          <textarea id="vmlb-sum-version-reason" v-model="reason" rows="4" placeholder="What is wrong with this version?" />
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
.vmlb-sum-history { margin-top: var(--vmlb-space-md); }
.vmlb-sum-timeline { list-style: none; margin: 0; padding: 0 0 0 var(--vmlb-space-md); border-left: 2px solid var(--vmlb-border); display: flex; flex-direction: column; gap: var(--vmlb-space-md); }
.vmlb-sum-timeline li { position: relative; padding: var(--vmlb-space-sm) var(--vmlb-space-md); border-radius: var(--vmlb-radius-md); background: var(--vmlb-surface-sunken); }
.vmlb-sum-timeline li::before {
  content: ''; position: absolute; left: calc(-1 * var(--vmlb-space-md) - 6px); top: 1rem;
  width: 10px; height: 10px; border-radius: 50%; background: var(--vmlb-accent); border: 2px solid var(--vmlb-surface);
}
.vmlb-sum-timeline li.rejected::before { background: var(--vmlb-error); }
.vmlb-sum-timeline li.rejected .vmlb-sum-text { color: var(--vmlb-text-muted); }
.vmlb-sum-timeline .vmlb-badge { margin-right: 0.375rem; }
.vmlb-sum-text { margin: 0.5rem 0 0; white-space: pre-wrap; line-height: 1.6; font-size: var(--vmlb-font-size-md); }
.vmlb-sum-rejected { margin: 0.5rem 0 0; font-size: var(--vmlb-font-size-sm); color: var(--vmlb-error); }
.vmlb-sum-end { display: flex; justify-content: flex-end; }
.vmlb-sum-danger { color: var(--vmlb-error); }
.vmlb-modal .vmlb-muted { margin: 0 0 var(--vmlb-space-md); }
</style>
