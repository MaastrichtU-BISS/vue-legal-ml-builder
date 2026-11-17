<script setup lang="ts">
import { inject, ref } from 'vue'
import type { MLAdapter, SummaryDocument } from '../types'
import type { ThemeId } from '../theme'

const injectedAdapter = inject<MLAdapter | null>('vmlb:adapter', null)

type View =
  | { name: 'datasets' }
  | { name: 'models' }
  | { name: 'create'; datasetId?: string }
  | { name: 'train'; modelId: string }
  | { name: 'compare' }
  | { name: 'detail'; modelId: string }
  | { name: 'summarize' }

const view = ref<View>({ name: 'datasets' })
const theme = ref<ThemeId>('ink')

const NAV = [
  { name: 'datasets' as const, label: 'Datasets' },
  { name: 'models' as const, label: 'Models' },
  { name: 'compare' as const, label: 'Compare' },
  { name: 'summarize' as const, label: 'Summarise' },
]

const SAMPLE_DOCUMENTS: SummaryDocument[] = [
  {
    id: 'gdpr-17',
    name: 'GDPR Article 17: Right to erasure',
    content:
      'The data subject shall have the right to obtain from the controller the erasure of personal data concerning him or her without undue delay. The controller shall have the obligation to erase personal data without undue delay where the personal data are no longer necessary in relation to the purposes for which they were collected. The same applies where the data subject withdraws consent and there is no other legal ground for the processing.',
  },
  {
    id: 'bw-6-162',
    name: 'Dutch Civil Code, Article 6:162',
    content:
      'A person who commits a tortious act against another person that can be attributed to him, must repair the damage that this other person has suffered as a result thereof. As a tortious act is regarded a violation of someone else\'s right. An act or omission in violation of a duty imposed by law, or of what according to unwritten law has to be regarded as proper social conduct, is also regarded as such.',
  },
]

function go(name: 'datasets' | 'models' | 'compare' | 'summarize') {
  view.value = { name }
}
</script>

<template>
  <div class="demo-shell vmlb-theme" :data-vmlb-theme="theme">
    <a class="demo-skip" href="#demo-main">Skip to content</a>

    <header class="demo-header">
      <div class="demo-brand">
        <span class="demo-mark">§</span>
        <div>
          <p class="demo-wordmark vmlb-display">Legal ML workbench</p>
          <p class="demo-tagline">Datasets, models, training, and annotation</p>
        </div>
      </div>

      <div class="demo-header-end">
        <nav class="demo-nav" aria-label="Primary">
          <button
            v-for="item in NAV"
            :key="item.name"
            :class="{ active: view.name === item.name }"
            :aria-current="view.name === item.name ? 'page' : undefined"
            @click="go(item.name)"
          >
            {{ item.label }}
          </button>
        </nav>
        <ThemeSwitcher v-model="theme" :show-label="false" />
      </div>
    </header>

    <main id="demo-main" class="demo-main">
      <DatasetManager
        v-if="view.name === 'datasets'"
        @create-model="(ds: any) => (view = { name: 'create', datasetId: ds.id })"
        @eda="() => {}"
        @view="() => {}"
      />
      <ModelList
        v-else-if="view.name === 'models'"
        @create="view = { name: 'create' }"
        @view="(m: any) => (view = { name: 'detail', modelId: m.id })"
        @train="(m: any) => (view = { name: 'train', modelId: m.id })"
      />
      <ModelCreateWizard
        v-else-if="view.name === 'create'"
        :dataset-id="view.datasetId"
        @created="(m: any) => (view = { name: 'train', modelId: m.id })"
        @cancel="view = { name: 'models' }"
      />
      <TrainingMonitor v-else-if="view.name === 'train'" :model-id="view.modelId" />
      <ParameterPerformanceExplorer
        v-else-if="view.name === 'compare'"
        :adapter="injectedAdapter ?? undefined"
        model-type="svm"
      />
      <ModelDetail
        v-else-if="view.name === 'detail'"
        :adapter="injectedAdapter ?? undefined"
        :model-id="view.modelId"
        @train="view = { name: 'train', modelId: (view as any).modelId }"
      />
      <SummarizationWidget
        v-else-if="view.name === 'summarize'"
        title="Summarise"
        subtitle="Paste a judgment or statute, or pick a document. Extractive models pick sentences from the text."
        :documents="SAMPLE_DOCUMENTS"
        :poll-interval="800"
      />
    </main>

    <footer class="demo-footer">
      <span class="vmlb-muted">vue-legal-ml-builder · demo workbench</span>
      <button class="demo-back" @click="view = { name: 'datasets' }">Back to datasets</button>
    </footer>
  </div>
</template>

<style>
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--vmlb-font-sans);
  background: var(--vmlb-canvas);
  color: var(--vmlb-text);
}
.demo-shell { min-height: 100dvh; display: flex; flex-direction: column; }
.demo-skip {
  position: absolute; left: -999px; top: 0; z-index: 999;
  padding: 0.5rem 0.75rem; border-radius: 0 0 0.5rem 0;
  background: var(--vmlb-accent); color: var(--vmlb-on-accent);
}
.demo-skip:focus { left: 0; }
.demo-header {
  display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;
  padding: 1.1rem max(1.5rem, calc((100% - var(--vmlb-container)) / 2));
  border-bottom: 1px solid var(--vmlb-border);
  background: color-mix(in srgb, var(--vmlb-surface) 88%, transparent);
  backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: var(--vmlb-z-sticky);
}
.demo-brand { display: flex; align-items: center; gap: 0.75rem; }
.demo-mark {
  display: grid; place-items: center;
  width: 2.25rem; height: 2.25rem;
  border-radius: var(--vmlb-radius-sm);
  background: var(--vmlb-accent); color: var(--vmlb-on-accent);
  font-family: var(--vmlb-font-display); font-size: 1.35rem; line-height: 1;
}
.demo-wordmark { margin: 0; font-size: 1.15rem; }
.demo-tagline { margin: 0; font-size: 0.75rem; color: var(--vmlb-text-muted); }
.demo-header-end { display: flex; align-items: center; gap: 1rem; }
.demo-nav { display: flex; gap: 0.25rem; }
.demo-nav button {
  padding: 0.4rem 0.85rem; border: none; border-radius: var(--vmlb-radius-md);
  background: transparent; color: var(--vmlb-text-muted);
  font-family: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: background-color var(--vmlb-duration) var(--vmlb-ease), color var(--vmlb-duration) var(--vmlb-ease);
}
.demo-nav button:hover { background: var(--vmlb-surface-sunken); color: var(--vmlb-text); }
.demo-nav button.active { background: var(--vmlb-accent-soft); color: var(--vmlb-accent-strong); }
.demo-main { flex: 1; width: 100%; max-width: var(--vmlb-container); margin-inline: auto; padding: 2.5rem 1.5rem 4rem; }
.demo-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1.5rem max(1.5rem, calc((100% - var(--vmlb-container)) / 2));
  border-top: 1px solid var(--vmlb-border);
}
.demo-back {
  border: none; background: none; color: var(--vmlb-accent-strong);
  font-family: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
}
.demo-back:hover { text-decoration: underline; text-underline-offset: 2px; }
</style>
