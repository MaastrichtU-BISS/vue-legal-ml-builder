<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DocumentSegment, SummaryStoreAdapter, SummaryStoreId } from '../../types'
import Icon from '../shared/Icon.vue'

const props = defineProps<{
  store: SummaryStoreAdapter
  taskId: SummaryStoreId
  documentId: SummaryStoreId
  /** The document's text, sent to `resegment`. */
  fullText: string
  /** Passed to `resegment` as is (host-defined). */
  source?: string
}>()

const segments = ref<DocumentSegment[]>([])
const isLoading = ref(false)
const isUpdating = ref(false)
const error = ref<string | null>(null)
const editing = ref<DocumentSegment | null>(null)

// Each control shows only when the store implements it.
const canList = computed(() => typeof props.store.listSegments === 'function')
const canResegment = computed(() => typeof props.store.resegment === 'function')
const canUpdate = computed(() => typeof props.store.updateSegment === 'function')
const canDelete = computed(() => typeof props.store.deleteSegment === 'function')

async function load() {
  if (!props.store.listSegments) return
  isLoading.value = true
  error.value = null
  try {
    segments.value = await props.store.listSegments(props.taskId, props.documentId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load the segments.'
  } finally {
    isLoading.value = false
  }
}

async function resegment() {
  if (!props.store.resegment) return
  isLoading.value = true
  error.value = null
  try {
    segments.value = await props.store.resegment(props.taskId, props.documentId, props.fullText, props.source)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to segment the text again.'
  } finally {
    isLoading.value = false
  }
}

function openEdit(segment: DocumentSegment) {
  if (canUpdate.value) editing.value = { ...segment }
}

async function saveEdit() {
  if (!editing.value || !props.store.updateSegment) return
  isUpdating.value = true
  error.value = null
  try {
    await props.store.updateSegment(editing.value.id, {
      segment_type: editing.value.segment_type,
      segment_text: editing.value.segment_text,
    })
    editing.value = null
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save the segment.'
  } finally {
    isUpdating.value = false
  }
}

async function remove(id: SummaryStoreId) {
  if (!props.store.deleteSegment) return
  error.value = null
  try {
    await props.store.deleteSegment(id)
    segments.value = segments.value.filter((s) => String(s.id) !== String(id))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete the segment.'
  }
}

watch(() => [props.taskId, props.documentId], load, { immediate: true })
</script>

<template>
  <div class="vmlb-card vmlb-sum-segments">
    <div class="vmlb-row vmlb-sum-segments-head">
      <h3 class="vmlb-card-title">Segments</h3>
      <button v-if="canResegment" type="button" class="vmlb-btn-secondary" :disabled="isLoading" @click="resegment">
        {{ isLoading ? 'Working…' : 'Segment again' }}
      </button>
    </div>

    <p v-if="!canList" class="vmlb-muted">This store does not keep segments.</p>
    <p v-else-if="isLoading && !segments.length" class="vmlb-muted">Loading the segments…</p>
    <p v-else-if="!segments.length" class="vmlb-muted">No segments yet.</p>

    <ul v-else class="vmlb-sum-segment-list">
      <li v-for="segment in segments" :key="String(segment.id)">
        <component
          :is="canUpdate ? 'button' : 'div'"
          :type="canUpdate ? 'button' : undefined"
          class="vmlb-sum-segment"
          :class="{ editable: canUpdate }"
          @click="openEdit(segment)"
        >
          <span class="vmlb-label">{{ segment.segment_type || 'Segment' }}</span>
          <span class="vmlb-sum-segment-text">{{ segment.segment_text.length > 160 ? `${segment.segment_text.slice(0, 160)}…` : segment.segment_text }}</span>
        </component>
        <button v-if="canDelete" type="button" class="vmlb-icon-btn" title="Delete segment" aria-label="Delete segment" @click="remove(segment.id)">
          <Icon name="close" />
        </button>
      </li>
    </ul>

    <div v-if="error" class="vmlb-alert-error" role="alert"><Icon name="alert" /> {{ error }}</div>

    <div v-if="editing" class="vmlb-modal-backdrop" @click.self="editing = null">
      <div class="vmlb-modal vmlb-sum-wide" role="dialog" aria-modal="true" aria-labelledby="vmlb-sum-edit-segment">
        <div class="vmlb-modal-head">
          <h3 id="vmlb-sum-edit-segment">Edit segment</h3>
          <button type="button" class="vmlb-icon-btn" aria-label="Close" @click="editing = null"><Icon name="close" /></button>
        </div>
        <div class="vmlb-field">
          <label for="vmlb-sum-segment-type">Type</label>
          <input id="vmlb-sum-segment-type" v-model="editing.segment_type" type="text" />
        </div>
        <div class="vmlb-field">
          <label for="vmlb-sum-segment-text">Text</label>
          <textarea id="vmlb-sum-segment-text" v-model="editing.segment_text" rows="8" />
        </div>
        <div class="vmlb-actions">
          <button type="button" class="vmlb-btn-secondary" @click="editing = null">Cancel</button>
          <button type="button" class="vmlb-btn-primary" :disabled="isUpdating" @click="saveEdit">
            {{ isUpdating ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vmlb-field input, .vmlb-field select, .vmlb-field textarea { box-sizing: border-box; }
.vmlb-sum-segments-head { align-items: center; margin-bottom: var(--vmlb-space-sm); }
.vmlb-sum-segments-head .vmlb-card-title { margin: 0; }
.vmlb-sum-segment-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.375rem; }
.vmlb-sum-segment-list li { display: flex; align-items: flex-start; gap: var(--vmlb-space-xs); }
.vmlb-sum-segment {
  flex: 1; display: flex; flex-direction: column; gap: 0.25rem; text-align: left;
  padding: 0.6rem 0.75rem; border: 1px solid var(--vmlb-border); border-radius: var(--vmlb-radius-md);
  background: var(--vmlb-surface); color: var(--vmlb-text); font: inherit;
}
.vmlb-sum-segment.editable { cursor: pointer; transition: border-color var(--vmlb-duration) var(--vmlb-ease); }
.vmlb-sum-segment.editable:hover { border-color: var(--vmlb-accent); }
.vmlb-sum-segment-text { font-size: 0.875rem; line-height: 1.5; }
.vmlb-sum-wide { max-width: 44rem; }
.vmlb-field textarea { resize: vertical; }
</style>
