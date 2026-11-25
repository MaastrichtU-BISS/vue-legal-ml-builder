<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { hasLabelErrors, validateLabels, type LabelDraft, type LabelErrors } from '../annotation/guide'
import type { Dataset, Id, MLAdapter } from '../types'
import Icon from './shared/Icon.vue'

// Step 1 of the guide, "Your labels": two or more names, each with one
// sentence saying when to use it. Labels already used on an item stay
// read-only, since they can't be renamed or removed.

const props = defineProps<{
  adapter: MLAdapter
  datasetId: Id
  /** The Dataset's labels now, and those used on an item. */
  labels: string[]
  inUse: string[]
  /** Known sentences per label, from the prompt or saved earlier. */
  descriptions: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'saved', saved: { dataset: Dataset; labels: string[]; descriptions: Record<string, string> }): void
}>()

function initialRows(): LabelDraft[] {
  const names = [...new Set([...props.inUse, ...props.labels])]
  const rows = names.map((name) => ({ name, description: props.descriptions[name] ?? '', locked: props.inUse.includes(name) }))
  while (rows.length < 2) rows.push({ name: '', description: '', locked: false })
  return rows
}

const rows = ref<LabelDraft[]>(initialRows())
const attempted = ref(false)
const saving = ref(false)
const serverError = ref<string | null>(null)
const NO_ERRORS: LabelErrors = { list: null, names: {}, descriptions: {} }
/** Field errors show once Save was pressed, then follow the typing. */
const shownErrors = computed(() => (attempted.value ? validateLabels(rows.value) : NO_ERRORS))
const root = ref<HTMLElement | null>(null)

const nameId = (i: number) => `vmlb-guide-label-${props.datasetId}-${i}`
const descriptionId = (i: number) => `vmlb-guide-desc-${props.datasetId}-${i}`

async function addRow() {
  rows.value = [...rows.value, { name: '', description: '', locked: false }]
  await nextTick()
  document.getElementById(nameId(rows.value.length - 1))?.focus()
}

function removeRow(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
}

async function save() {
  attempted.value = true
  serverError.value = null
  if (hasLabelErrors(validateLabels(rows.value))) {
    await nextTick()
    root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  const labels = rows.value.map((row) => row.name.trim())
  const descriptions = Object.fromEntries(rows.value.map((row) => [row.name.trim(), row.description.trim()]))
  saving.value = true
  try {
    const dataset = await props.adapter.setDatasetLabels!(props.datasetId, labels)
    emit('saved', { dataset, labels: dataset?.labels?.length ? dataset.labels : labels, descriptions })
  } catch (err) {
    // What was typed stays, so the student can fix it and try again.
    serverError.value = err instanceof Error && err.message ? err.message : "Your labels couldn't be saved. Try again."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form ref="root" class="vmlb-guide-labels" novalidate @submit.prevent="save">
    <p class="vmlb-guide-text">
      Give each label a short name and one sentence saying when to use it. The AI reads these sentences, so write them
      the way you would explain it to a classmate.
    </p>

    <ul class="vmlb-guide-label-list">
      <li v-for="(row, i) in rows" :key="i" class="vmlb-guide-label-row">
        <div class="vmlb-guide-label-name">
          <template v-if="row.locked">
            <span :id="nameId(i)" class="vmlb-guide-locked">
              <Icon name="lock" />
              <span class="vmlb-guide-locked-name">{{ row.name }}</span>
              <span class="vmlb-guide-in-use">In use</span>
            </span>
          </template>
          <template v-else>
            <label class="vmlb-guide-sr" :for="nameId(i)">Label name {{ i + 1 }}</label>
            <input
              :id="nameId(i)"
              v-model="row.name"
              class="vmlb-input vmlb-guide-input"
              type="text"
              placeholder="Label name"
              maxlength="100"
              :aria-invalid="shownErrors.names[i] ? 'true' : undefined"
              :aria-describedby="shownErrors.names[i] ? `${nameId(i)}-error` : undefined"
            />
            <p v-if="shownErrors.names[i]" :id="`${nameId(i)}-error`" class="vmlb-guide-field-error">{{ shownErrors.names[i] }}</p>
          </template>
        </div>
        <div class="vmlb-guide-label-desc">
          <label class="vmlb-guide-sr" :for="descriptionId(i)">When to use {{ row.name.trim() || `label ${i + 1}` }}</label>
          <input
            :id="descriptionId(i)"
            v-model="row.description"
            class="vmlb-input vmlb-guide-input"
            type="text"
            placeholder="One sentence saying when to use it"
            maxlength="500"
            :aria-invalid="shownErrors.descriptions[i] ? 'true' : undefined"
            :aria-describedby="shownErrors.descriptions[i] ? `${descriptionId(i)}-error` : undefined"
          />
          <p v-if="shownErrors.descriptions[i]" :id="`${descriptionId(i)}-error`" class="vmlb-guide-field-error">{{ shownErrors.descriptions[i] }}</p>
        </div>
        <button
          v-if="!row.locked && rows.length > 1"
          type="button"
          class="vmlb-btn-tertiary vmlb-guide-remove"
          :aria-label="`Remove ${row.name.trim() || `label ${i + 1}`}`"
          @click="removeRow(i)"
        >
          Remove
        </button>
      </li>
    </ul>
    <p v-if="shownErrors.list" class="vmlb-guide-field-error" role="alert">{{ shownErrors.list }}</p>

    <div class="vmlb-guide-actions">
      <button type="button" class="vmlb-btn-secondary vmlb-guide-target" :disabled="saving" @click="addRow">
        <Icon name="plus" /> Add a label
      </button>
      <button type="submit" class="vmlb-btn-primary vmlb-guide-target" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save labels' }}
      </button>
    </div>
    <div v-if="serverError" class="vmlb-alert-error vmlb-guide-server-error" role="alert"><Icon name="alert" /> {{ serverError }}</div>
    <p class="vmlb-guide-note">You need at least two. Once you start labelling you can still add labels, but not rename or remove them.</p>
  </form>
</template>

<style scoped>
.vmlb-guide-labels { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-label-list { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); margin: 0; padding: 0; list-style: none; }
.vmlb-guide-label-row { display: grid; grid-template-columns: 12rem 1fr auto; gap: var(--vmlb-space-xs); align-items: start; }
.vmlb-guide-input { min-height: 2.75rem; }
.vmlb-guide-locked {
  display: flex; align-items: center; gap: var(--vmlb-space-xs);
  min-height: 2.75rem; padding: 0 var(--vmlb-space-sm);
  border: 1px solid var(--vmlb-border); border-radius: var(--vmlb-radius-md);
  background: var(--vmlb-surface-sunken); color: var(--vmlb-text);
}
.vmlb-guide-locked-name { font-weight: 600; overflow-wrap: anywhere; }
.vmlb-guide-in-use {
  margin-left: auto; padding: 0.1rem var(--vmlb-space-xs);
  border: 1px solid var(--vmlb-border-strong); border-radius: 999px;
  color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-xs); white-space: nowrap;
}
.vmlb-guide-remove { min-height: 2.75rem; }
.vmlb-guide-field-error { margin: var(--vmlb-space-2xs) 0 0; color: var(--vmlb-error); font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-actions { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-sm); }
.vmlb-guide-target { min-height: 2.75rem; }
.vmlb-guide-server-error { margin: 0; }
.vmlb-guide-note { margin: 0; color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
@media (max-width: 640px) {
  .vmlb-guide-label-row { grid-template-columns: 1fr; }
}
</style>
