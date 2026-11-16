<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SummaryInput } from '../../composables/useSummarization'
import type { SummaryDocument } from '../../types'
import Icon from '../shared/Icon.vue'

type Tab = 'paste' | 'upload' | 'select'

const props = defineProps<{
  initialText?: string
  /** Offered in the "Select document" tab. */
  documents?: SummaryDocument[]
}>()

const emit = defineEmits<{
  /** The texts to summarise, from the tab on screen only. */
  'update:inputs': [inputs: SummaryInput[]]
}>()

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'paste', label: 'Paste text' },
  { id: 'upload', label: 'Upload files' },
  { id: 'select', label: 'Select documents' },
]

const activeTab = ref<Tab>('paste')
const pasteText = ref(props.initialText ?? '')
const selectedIds = ref<Set<string>>(new Set())
const uploads = ref<Array<{ name: string; text: string }>>([])
const uploadError = ref<string | null>(null)

function inputsFor(tab: Tab): SummaryInput[] {
  if (tab === 'paste') return pasteText.value.trim() ? [{ text: pasteText.value }] : []
  if (tab === 'select') {
    return (props.documents ?? []).filter((d) => selectedIds.value.has(d.id)).map((d) => ({ text: d.content, document: d }))
  }
  return uploads.value.map(({ name, text }) => ({ text, document: { id: name, name, content: text } }))
}

function publish() {
  emit('update:inputs', inputsFor(activeTab.value))
}

watch([pasteText, uploads, () => props.documents], publish, { deep: true, immediate: true })
watch(() => props.initialText, (v) => {
  if (v !== undefined) pasteText.value = v
})

function switchTab(tab: Tab) {
  activeTab.value = tab
  publish()
}

function toggleDocument(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
  publish()
}

// Plain text only: a PDF or Word file read as text would send its bytes to the server.
function isTextFile(file: File): boolean {
  return file.type === 'text/plain' || /\.txt$/i.test(file.name)
}

async function onFileChange(event: Event) {
  uploadError.value = null
  const files = Array.from((event.target as HTMLInputElement).files ?? [])
  const accepted: Array<{ name: string; text: string }> = []
  for (const file of files) {
    if (!isTextFile(file)) {
      uploadError.value = `"${file.name}" is not a plain text file. Upload .txt files.`
      continue
    }
    try {
      accepted.push({ name: file.name, text: await file.text() })
    } catch {
      uploadError.value = `Could not read "${file.name}".`
    }
  }
  uploads.value = accepted
}

function removeUpload(name: string) {
  uploads.value = uploads.value.filter((f) => f.name !== name)
}
</script>

<template>
  <div class="vmlb-sum-input">
    <div class="vmlb-sum-tabs" role="tablist" aria-label="Text to summarise">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        role="tab"
        class="vmlb-sum-tab"
        :class="{ active: activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        @click="switchTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'paste'" class="vmlb-field" role="tabpanel">
      <textarea v-model="pasteText" rows="8" placeholder="Paste or type the text to summarise…" aria-label="Text to summarise" />
    </div>

    <div v-else-if="activeTab === 'upload'" role="tabpanel">
      <label class="vmlb-btn-secondary vmlb-sum-file">
        <input type="file" accept=".txt,text/plain" multiple @change="onFileChange" />
        <Icon name="upload" /> Choose .txt files
      </label>
      <p v-if="uploadError" class="vmlb-alert-error vmlb-sum-gap" role="alert">{{ uploadError }}</p>
      <ul v-if="uploads.length" class="vmlb-sum-list">
        <li v-for="f in uploads" :key="f.name">
          <span>{{ f.name }}</span>
          <button type="button" class="vmlb-icon-btn" :aria-label="`Remove ${f.name}`" @click="removeUpload(f.name)">
            <Icon name="close" />
          </button>
        </li>
      </ul>
    </div>

    <div v-else role="tabpanel">
      <p v-if="!documents?.length" class="vmlb-muted">No documents to choose from.</p>
      <ul v-else class="vmlb-sum-list">
        <li v-for="doc in documents" :key="doc.id" :class="{ selected: selectedIds.has(doc.id) }">
          <label>
            <input type="checkbox" :checked="selectedIds.has(doc.id)" @change="toggleDocument(doc.id)" />
            {{ doc.name }}
          </label>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.vmlb-sum-tabs { display: flex; gap: 0.25rem; margin-bottom: var(--vmlb-space-md); border-bottom: 1px solid var(--vmlb-border); }
.vmlb-sum-tab {
  margin-bottom: -1px; padding: 0.5rem 0.85rem;
  border: none; border-bottom: 2px solid transparent; background: none;
  color: var(--vmlb-text-muted); font-family: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: color var(--vmlb-duration) var(--vmlb-ease), border-color var(--vmlb-duration) var(--vmlb-ease);
}
.vmlb-sum-tab:hover { color: var(--vmlb-text); }
.vmlb-sum-tab.active { color: var(--vmlb-accent-strong); border-bottom-color: var(--vmlb-accent); }
.vmlb-field textarea { box-sizing: border-box; resize: vertical; min-height: 10rem; line-height: 1.5; }
.vmlb-sum-file { position: relative; }
.vmlb-sum-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.vmlb-sum-gap { margin-top: var(--vmlb-space-sm); }
.vmlb-sum-list { list-style: none; margin: var(--vmlb-space-sm) 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.375rem; }
.vmlb-sum-list li {
  display: flex; align-items: center; justify-content: space-between; gap: var(--vmlb-space-sm);
  padding: 0.5rem 0.75rem; border: 1px solid var(--vmlb-border); border-radius: var(--vmlb-radius-md);
  background: var(--vmlb-surface); font-size: 0.875rem;
}
.vmlb-sum-list li.selected { border-color: var(--vmlb-accent); background: var(--vmlb-accent-soft); }
.vmlb-sum-list label { display: flex; align-items: center; gap: 0.5rem; flex: 1; cursor: pointer; }
.vmlb-sum-list input[type='checkbox'] { accent-color: var(--vmlb-accent); }
</style>
