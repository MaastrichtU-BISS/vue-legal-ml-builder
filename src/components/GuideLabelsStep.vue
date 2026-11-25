<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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

/** A row with a key that stays with it when rows above it are removed. */
type Row = LabelDraft & { key: number }
let nextKey = 0
const blank = (): Row => ({ key: nextKey++, name: '', description: '', locked: false })
const isBlank = (row: Row) => !row.locked && !row.name.trim() && !row.description.trim()

function initialRows(): Row[] {
  const names = [...new Set([...props.inUse, ...props.labels])]
  const rows = names.map((name) => ({ key: nextKey++, name, description: props.descriptions[name] ?? '', locked: props.inUse.includes(name) }))
  while (rows.length < 2) rows.push(blank())
  return rows
}

const rows = ref<Row[]>(initialRows())

/** Labels found in use, or named, after the form showed (they can arrive late)
 * join it, in-use ones locked; known sentences fill empty fields. What the
 * student typed is never overwritten. */
function mergeKnown() {
  const next = [...rows.value]
  // Names compare ignoring case, like validation and the server.
  const find = (name: string) => next.find((row) => row.name.trim().toLowerCase() === name.toLowerCase())
  const focusedId = typeof document === 'undefined' ? null : document.activeElement?.id ?? null
  const insert = (row: Row) => {
    // Take the place of an untouched empty row, so the form doesn't grow blanks,
    // but never the one the student is in.
    const empty = next.findIndex((r) => isBlank(r) && nameId(r) !== focusedId && descriptionId(r) !== focusedId)
    if (empty >= 0) next.splice(empty, 1)
    const firstUnlocked = next.findIndex((r) => !r.locked)
    next.splice(row.locked ? (firstUnlocked < 0 ? next.length : firstUnlocked) : next.length, 0, row)
  }
  for (const name of props.inUse) {
    const row = find(name)
    // A label in use keeps the server's spelling.
    if (row) Object.assign(row, { name, locked: true })
    else insert({ key: nextKey++, name, description: props.descriptions[name] ?? '', locked: true })
  }
  for (const name of props.labels) {
    if (!find(name)) insert({ key: nextKey++, name, description: props.descriptions[name] ?? '', locked: false })
  }
  for (const row of next) {
    const known = props.descriptions[row.name.trim()]
    if (!row.description.trim() && known) row.description = known
  }
  while (next.length < 2) next.push(blank())
  rows.value = next
}
watch(() => [props.inUse.join('\u0000'), props.labels.join('\u0000'), JSON.stringify(props.descriptions)], mergeKnown)

const attempted = ref(false)
const saving = ref(false)
const serverError = ref<string | null>(null)
const NO_ERRORS: LabelErrors = { list: null, names: {}, descriptions: {} }
/** Field errors show once Save was pressed, then follow the typing. */
const shownErrors = computed(() => (attempted.value ? validateLabels(rows.value) : NO_ERRORS))
const root = ref<HTMLElement | null>(null)
const addButton = ref<HTMLButtonElement | null>(null)

const nameId = (row: Row) => `vmlb-guide-label-${props.datasetId}-${row.key}`
const descriptionId = (row: Row) => `vmlb-guide-desc-${props.datasetId}-${row.key}`

async function addRow() {
  const row = blank()
  rows.value = [...rows.value, row]
  await nextTick()
  document.getElementById(nameId(row))?.focus()
}

/** Focus moves to the next row's name, or to "Add a label" when none is left. */
async function removeRow(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
  await nextTick()
  const next = rows.value.slice(index).find((row) => !row.locked)
  const field = next && document.getElementById(nameId(next))
  if (field) field.focus()
  else addButton.value?.focus()
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
      <li v-for="(row, i) in rows" :key="row.key" class="vmlb-guide-label-row">
        <div class="vmlb-guide-label-name">
          <template v-if="row.locked">
            <span :id="nameId(row)" class="vmlb-guide-locked">
              <Icon name="lock" />
              <span class="vmlb-guide-locked-name">{{ row.name }}</span>
              <span class="vmlb-guide-in-use">In use</span>
            </span>
          </template>
          <template v-else>
            <!-- Visible labels: a placeholder alone disappears once the student types. -->
            <label class="vmlb-guide-field-label" :for="nameId(row)">Label name<span class="vmlb-guide-sr"> {{ i + 1 }}</span></label>
            <input
              :id="nameId(row)"
              v-model="row.name"
              class="vmlb-input vmlb-guide-input"
              type="text"
              placeholder="Label name"
              maxlength="100"
              :aria-invalid="shownErrors.names[i] ? 'true' : undefined"
              :aria-describedby="shownErrors.names[i] ? `${nameId(row)}-error` : undefined"
            />
            <p v-if="shownErrors.names[i]" :id="`${nameId(row)}-error`" class="vmlb-guide-field-error">{{ shownErrors.names[i] }}</p>
          </template>
        </div>
        <div class="vmlb-guide-label-desc">
          <label class="vmlb-guide-field-label" :for="descriptionId(row)">When to use it<span class="vmlb-guide-sr"> ({{ row.name.trim() || `label ${i + 1}` }})</span></label>
          <input
            :id="descriptionId(row)"
            v-model="row.description"
            class="vmlb-input vmlb-guide-input"
            type="text"
            placeholder="One sentence saying when to use it"
            maxlength="500"
            :aria-invalid="shownErrors.descriptions[i] ? 'true' : undefined"
            :aria-describedby="shownErrors.descriptions[i] ? `${descriptionId(row)}-error` : undefined"
          />
          <p v-if="shownErrors.descriptions[i]" :id="`${descriptionId(row)}-error`" class="vmlb-guide-field-error">{{ shownErrors.descriptions[i] }}</p>
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
      <button ref="addButton" type="button" class="vmlb-btn-secondary vmlb-guide-target" :disabled="saving" @click="addRow">
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
.vmlb-guide-field-label { display: block; margin-bottom: var(--vmlb-space-2xs); color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm); }
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
/* Line the button up with the inputs under their visible labels. */
@media (min-width: 641px) { .vmlb-guide-remove { margin-top: calc(var(--vmlb-font-size-sm) * 1.5 + var(--vmlb-space-2xs)); } }
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
