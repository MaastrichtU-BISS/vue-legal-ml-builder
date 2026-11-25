# vue-legal-ml-builder

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/shashankmc/vue-legal-ml-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/shashankmc/vue-legal-ml-builder/actions/workflows/ci.yml)

Vue 3 component library for the BAIGLE legal-ML workbench — dataset
management, model configuration/training/prediction, visualization,
annotation, experiment monitoring, and summarization. Extracted from the
`reducing_digital_divide` monorepo's SvelteKit frontend, and embedded back
into it via a manual Vue-in-Svelte mount bridge (`VueMount.svelte`).

Components never call an API directly — a single pluggable `MLAdapter`
object, provided via the Vue plugin or passed as an explicit prop, is the
entire backend contract.

## Install

```bash
npm install vue-legal-ml-builder vue plotly.js-basic-dist
```

Published to the public npm registry (no token needed to install). Pin an exact
version (`vue-legal-ml-builder@x.y.z`) in host apps.

**Host requirements.** `vue` (^3.4) is a peer dependency. `plotly.js-basic-dist`
(^2.35) is externalized from the library build and loaded with a dynamic
`import('plotly.js-basic-dist')` the first time a chart renders, so the host's
bundler must be able to resolve it. Add it as a direct dependency of the host
(Legal Blocks does this; strict installers such as pnpm and Nuxt/Vite
pre-bundling otherwise may not see the transitive copy). Without it the chart
components either break the host build (unresolved import) or render empty.

`legal-annotation-kit` is a regular dependency, externalized from the library
build, so it installs with the builder; its styles are already in
`vue-legal-ml-builder/style.css`.

```ts
import { createApp } from 'vue'
import { VueLegalMlBuilderPlugin, createSelfHostedAdapter } from 'vue-legal-ml-builder'
import 'vue-legal-ml-builder/style.css'

const app = createApp(RootComponent)
app.use(VueLegalMlBuilderPlugin, {
  adapter: createSelfHostedAdapter({ apiUrl: '/api', getAuthToken: () => localStorage.getItem('token') }),
})
```

Or use components directly without the plugin, passing `adapter` explicitly:

```vue
<ModelCreateWizard :adapter="adapter" :dataset-id="datasetId" @created="onCreated" />
```

## Hiding annotation

Hosts with their own annotation (Legal Blocks) can hide the builder's annotation
view. `AnnotationWorkspace` is the one component that reads the flag: hidden, it
renders nothing and never calls the adapter's annotation operations
(`getNextAnnotationTask`, `saveAnnotation`, `skipAnnotation`), so a host need
not implement or proxy them. Default: shown (BAIGLE is unchanged).

```ts
app.use(VueLegalMlBuilderPlugin, { adapter, hideAnnotation: true })
```

Or per component, for direct (non-plugin) usage; the prop overrides the plugin option:

```vue
<AnnotationWorkspace :adapter="adapter" :project-id="id" :hide-annotation="true" />
```

## Components

`DatasetManager`, `DatasetEda`, `ModelList`, `ModelCreateWizard`, `ModelDetail`,
`TrainingMonitor` (composes `TrainingCurves`), `ParameterPerformanceExplorer`,
`AnnotationWorkspace` (shows each item in legal-annotation-kit's `AnnotatorView`,
through the required `getAnnotationAssignment` / `saveAnnotationAssignment`
adapter methods; composes `ActiveLearningPanel` when the adapter has the
optional active learning methods and the task is single-label classification, and
`LlmAssistPanel` when the adapter has the optional LLM methods; see
[LLM suggestions](#llm-suggestions)),
`SummarizationWidget` and the summary store components (see
[Summarization](#summarization)), plus shared primitives
`ConfusionMatrix`/`PlotlyChart`/`ModelLens`/`MlBuilderThemeProvider`.

`TrainingCurves` and `ParameterPerformanceExplorer` are the experiment-monitoring
pieces (mlop.ai-inspired): live per-training-job metric curves and cross-run
hyperparameter-vs-performance comparison. Live curves are dense only for the
LegalBERT/RoBERTa training path — classical sklearn algorithms only produce a
few coarse phase-marker points (see `legal-ml-core`'s README for why), unless
the run turns on `parameters.monitoring.learning_curve`. Its `learning_curve_*`
points are drawn on a chart of their own, "Learning curve", against the number
of training examples (their `training_step`), whatever `groupBy` and `xAxis` say.
`isLearningCurvePoint(point)` tells them apart in a custom slot. Each point's
`x_kind` says what its `training_step` counts, and titles the x-axis: Training
step, Iteration (logistic regression's loss by iteration) or Training examples.

## Reviewing labels

Every row with text is an annotation task (legal-ml-core 0.13), and a row the
uploaded file labels starts labelled. When the adapter implements
`pageAnnotationTasks` (legal-ml-core `GET /annotation/projects/<id>/tasks` with
`status`, `label`, `limit`, `offset`, returning `total`), `AnnotationWorkspace`
offers **Review labels** once a Dataset has any: its labelled items in row order,
filterable by label, in the kit with Back/Next. Each shows where its label came
from (the file, a person, an LLM) and, for a changed file label, what the file
said. Only a real change is saved, as the person's label (`saveAnnotationAssignment`),
so moving past a file label leaves it the file's. NER items whose file lists
entity types show them as a hint above the text.

## Label with AI help (the guide)

For single-label task types (`classification`, `document_classification`,
`judgment_prediction`), when the adapter implements `getLlmStatus` and a
`datasetId` is given, `AnnotationWorkspace` opens a guided mode: one panel,
"Label with AI help", with a six-step rail (Your labels, Connect AI, Show it how,
Try it, Do the rest, Ready to train) and the current step under it. The step is
worked out every time from what the adapter reports (`guideStep`, exported):
the Dataset's labels, LLM access and acknowledgement, confirmed labels per label
(`pageAnnotationTasks` with `status: 'annotated'` and `label`, else the active
learning `label_counts`), the server's agreement numbers and the items left.

Step 1, "Your labels", names two or more labels with one sentence each. It needs
the optional `setDatasetLabels(datasetId, labels)` (legal-ml-core
`PUT /datasets/<id>/label-set` with `{"labels": [...]}`, returning `{dataset}`;
a refusal's plain `error` is shown). The sentences are then saved as the
prompt's definitions in a new prompt version; without LLM access yet they wait
in browser storage until the prompt next loads. They show beside the labels in
the labelling sidebar. Steps 2 to 6 show today's `LlmAssistPanel` controls for
now.

"Hide guide" is remembered per Dataset in browser storage
(`vmlb-guide-hidden:<datasetId>`) and shows today's panel, as described below,
with a "Show guide" link. A host can open the screen without the guide for one
visit with `guide="hidden"` (BAIGLE's "Label by hand"). Other task types say
"AI help isn't available for this kind of task yet."

## LLM suggestions

`AnnotationWorkspace` shows `LlmAssistPanel` above the item for single-label
classification (`classification`, `document_classification`,
`judgment_prediction`) when the adapter implements `getLlmStatus`, a `datasetId` is
given and the Dataset names at least two labels. An adapter without the LLM methods
(Legal Blocks) shows no LLM controls. The methods mirror legal-ml-core's `/api/llm`
routes, and `createSelfHostedAdapter` implements them all:

| Method | Route | Used for |
| --- | --- | --- |
| `getLlmStatus(datasetId?)` | `GET /llm/status` | Shared key, own key or none; destination; tokens left; whether the Project acknowledged |
| `saveLlmKey({ base_url, model, api_key })` | `PUT /llm/key` | Adding an own key. Write-only: the key is never returned |
| `deleteLlmKey()` | `DELETE /llm/key` | Deleting it |
| `acknowledgeLlmDestination(datasetId, destination)` | `POST /llm/datasets/<id>/acknowledgement` | Agreeing to the destination shown, before anything is sent |
| `getLlmPrompt(datasetId)` / `updateLlmPrompt(datasetId, { template, definitions })` | `GET`/`PUT /llm/datasets/<id>/prompt` | The prompt under Advanced, saved as a new version once checked |
| `createLlmSuggestions(datasetId, taskIds)` | `POST /llm/datasets/<id>/suggestions` | Suggest labels for this batch |
| `listLlmSuggestions(datasetId, status?)` | `GET /llm/datasets/<id>/suggestions` | Suggestions waiting on their items |
| `confirmLlmSuggestion(id, label?)` / `rejectLlmSuggestion(id)` | `POST /llm/suggestions/<id>/confirm`, `/reject` | Accept, correct or reject one suggestion |
| `getLlmAgreement(datasetId)` / `bulkAcceptLlmSuggestions(datasetId)` | `GET /llm/datasets/<id>/agreement`, `POST …/bulk-accept` | The agreement check, and bulk accept once it passes |
| `estimateLlmAnnotation(datasetId, taskIds?)` / `startLlmAnnotation(datasetId, taskIds?)` | `POST /llm/datasets/<id>/annotate/estimate`, `…/annotate` | Labelling many items at once, estimate first |
| `getLlmJob(jobId)` | `GET /llm/jobs/<id>` | Following that job |
| `estimateActiveLearningSeed(datasetId, { batch_size, holdout_percent })` | `POST /active-learning/datasets/<id>/seed-estimate` | Pricing an LLM-suggested first batch before Start |

A suggestion is never a label. The one waiting for the item on screen is passed to
legal-annotation-kit as a proposal: listed under **Suggestions** with the LLM's
rationale and its model and prompt version. It becomes a label only when the user
accepts it (`confirmLlmSuggestion(id)`), changes it to another label
(`confirmLlmSuggestion(id, label)`, a correction), or bulk accepts after the agreement
check passes; rejecting it calls `rejectLlmSuggestion(id)` and leaves the item to label
by hand. Saving the item with a label of one's own also confirms or corrects it, so the
agreement counts it. "Suggest labels for this batch" asks for the
next pending items in queue order (up to 10, legal-ml-core's default
`LLM_MAX_SYNC_TASKS`), read with `listAnnotationTasks`; without it, the item on screen.
Each method rejects with an `LlmRefusalError` whose `code` (`budget_exhausted`,
`acknowledgement_required`, `destination_changed`, …) and `destination` the panel reads
to tell the user what to do next. A custom adapter should set them the same way.

The own key is read from the form when it is sent and cleared from it straight after;
it is not kept in component state or storage. The panel polls a standalone job every
`pollInterval` milliseconds (plugin option, default 3000).

## Summarization

`SummarizationWidget` summarises pasted text, uploaded `.txt` files or documents
the host passes in `documents`, through legal-ml-core's `/api/summarize` routes.
It shows when the adapter implements the optional summarization methods; without
them it says summarisation is not available. `createSelfHostedAdapter` implements
them with the same base URL, bearer token and refresh as its other routes:

| Method | Route | Used for |
| --- | --- | --- |
| `summarize({ input_text, summary_length?, priority?, model?, request_id? })` | `POST /summarize` | Queues a summary; the job comes back `queued` |
| `getSummarizationJob(requestId)` | `GET /summarize/<request_id>` | Polled until the job is `complete` or `error` |
| `getSummarizationModels()` | `GET /summarize/models` | Fills the model picker |

```vue
<SummarizationWidget
  title="Summarise"
  :documents="[{ id: 'd1', name: 'Lease', content: leaseText }]"
  :allow-save="true"
  @save="(result) => store(result)"
/>
```

`summary_length` is `'short'`, `'medium'`, `'long'` or a target number of
words; `priority` weighs `relevance` and `readability` from 0 to 1. The model
picker lists the server's extractive models (`lex_rank`, `lsa`, `text_rank`,
`luhn`, `edmundson`) and its `hf:` abstractive ones, which are disabled while the
server reports `abstractive_available: false`. The server's `default` is
preselected; if the models cannot be loaded the picker is hidden and the server
chooses.

Progress is polled only; there is no push stream. The widget polls every
`pollInterval` milliseconds (prop, else the plugin option, else 1500). A 404,
which legal-ml-core sends for an unknown request, one older than its one-hour
lifetime or someone else's, ends the run with a message to start again, as does
any other 4xx. A network error or 5xx is retried, up to five failed polls in a
row. Several documents are summarised one after another, with progress across
the batch. `useSummarization(adapter, pollIntervalMs)` gives the same behaviour
without the widget.

The stored-summary components read a `SummaryStoreAdapter` the host supplies
through a `store` prop: there is no legal-ml-core route for them.
`SummaryResultsPanel` lists a task's summaries and rejects one for regeneration,
`SummaryVersionHistory` shows a document's versions, `SegmentationEditor` edits a
document's segments when the store implements the segment methods, and
`SummaryExportPanel` downloads the summaries as JSON or CSV (with the store's
`exportSummaries`, else `listSummaries`). `buildExport` and `downloadExport` are
exported for hosts that export elsewhere.

## Configuring the training curves

`TrainingCurves` draws a job's curves, and `TrainingMonitor` passes these props
through to it. Every one is optional; left unset, the curves look as before.

| prop | default | effect |
| --- | --- | --- |
| `metrics` | every metric | Only these metric names are drawn, e.g. `['loss', 'eval_accuracy']`. Stages are always shown. |
| `groupBy` | `'group'` | `'group'` draws one chart per group (Training, Evaluation, System), and the System readings one chart per unit, e.g. Memory (MB); `'none'` draws every metric on one chart. |
| `xAxis` | `'step'` | `'step'` or `'epoch'`. A point without the chosen one falls back to the other. |
| `pollIntervalMs` | `3000` | How often a running job is polled for new points. |
| `smoothing` | `0` | Moving-average weight, from 0 (raw values) to just below 1 (smoothest). |
| `logScale` | `false` | Draws values on a log scale. |

Set app-wide defaults once, through the plugin or `provide`. Each prop a
component is given overrides its own default:

```ts
app.use(VueLegalMlBuilderPlugin, { adapter, trainingCurves: { xAxis: 'epoch', smoothing: 0.6 } })
// or, without the plugin:
app.provide('vmlb:trainingCurves', { xAxis: 'epoch', smoothing: 0.6 })
```

To draw the curves your own way, use the default slot. It replaces the stage
timeline and charts (not the waiting or error message), and gets `charts` (one
per group, each with its `series` of `{ metric, x, y }`, after the settings
above), `stages` (`{ name, label, at }`, in order) and every raw `points`:

```vue
<TrainingCurves :job-id="jobId" :job-status="status">
  <template #default="{ charts, stages }">
    <MyChart v-for="chart in charts" :key="chart.group" :title="chart.title" :series="chart.series" />
  </template>
</TrainingCurves>
```

## Theming

Styling is driven entirely by `--vmlb-*` CSS custom properties, so the package
ships a curated set of named presets and lets hosts override any semantic token.

| id | label | mode |
| --- | --- | --- |
| `ink` | Ink — warm paper, deep teal (default) | light |
| `paper` | Paper — neutral white, graphite | light |
| `sepia` | Sepia — aged parchment, burnt sienna | light |
| `oxblood` | Oxblood — cool ivory, burgundy | light |
| `forest` | Forest — soft paper, deep green | light |
| `midnight` | Midnight — deep navy, steel cyan | dark |
| `dark` | Charcoal — warm charcoal, teal | dark |
| `contrast` | High contrast — accessibility | light |

Four ways to configure it.

**1. Plugin option** — a preset id, token overrides, or both:

```ts
app.use(VueLegalMlBuilderPlugin, {
  adapter,
  theme: 'midnight',
  // or: theme: { accent: '#7a2e2e', 'radius-md': '3px' },
  // or: theme: { preset: 'midnight', overrides: { accent: '#7ad1c4' } },
})
```

**2. Let the user pick** — drop in the `ThemeSwitcher` (v-model of a preset id),
or build your own picker from the exported `THEME_PRESETS` registry:

```vue
<ThemeSwitcher v-model="theme" />
```

```ts
import { THEME_PRESETS, type ThemeId } from 'vue-legal-ml-builder'
// THEME_PRESETS: { id, label, description, mode, swatches }[]
```

**3. Wrapper element** — scope a theme to a subtree (two themes on one page, no JS):

```html
<div class="vmlb-theme" data-vmlb-theme="midnight">
  <ModelList :adapter="adapter" />
</div>
```

**4. Plain CSS** — override the semantic tokens anywhere they cascade:

```css
:root {
  --vmlb-accent: #7a2e2e;
  --vmlb-font-display: "Fraunces", serif;
}
```

For direct (non-plugin) imports use `<MlBuilderThemeProvider :theme="…">` or the
`applyTheme(el, theme)` / `clearTheme(el)` / `createTheme(overrides)` helpers.
Preset styles are emitted automatically; `ensurePresetStyles()` is exported if you
need to inject them manually.

**Token contract.** Override the semantic tokens — never the internal `--vmlb-raw-*`
palette. The public keys (also exported as `themeTokens`, typed `ThemeToken`) are
`canvas`, `surface`, `surface-sunken`, `border`, `border-strong`, `text`,
`text-muted`, `text-subtle`, `accent`, `accent-strong`, `accent-soft`, `on-accent`,
`success`/`warning`/`error` (+ `-soft`), `font-display`/`font-sans`/`font-mono`,
`font-size-2xs`…`font-size-3xl` (`2xs`, `xs`, `sm`, `md`, `base`, `lg`, `xl`,
`2xl`, `3xl`), `label-case`/`label-tracking`, `radius-sm`/`md`/`lg`,
`shadow-sm`/`md`/`lg`, `space-2xs`…`space-2xl`, `container`, and `density`.
Every font size in the package is a `font-size-*` token, so a host can map the
scale onto its own; set `label-case: none` and `label-tracking: 0` for
sentence-case labels and eyebrows. Add `vmlb-theme--compact` for tighter density. Adding a preset is a
data-only change in `src/theme/presets.ts`.

## Visualization & bundle size

Charts use [Plotly](https://plotly.com/javascript/) via `plotly.js-basic-dist`
(the scatter + bar + pie partial build), dynamically imported and externalized
from the library build. This is deliberate: the full `plotly.js-dist` bundle is
~4.7 MB raw / ~1.4 MB gzipped, while the basic build is ~1.1 MB raw / ~380 KB
gzipped — about 75% smaller for the trace types this package actually renders.
`npm run check:size` builds the demo and enforces that budget in CI.

This package renders **scatter** (training curves, parameter explorer) and
**bar** (model performance) figures. EDA distributions are drawn as HTML by
`DatasetEda`, not Plotly — so the even smaller `plotly.js-basic-dist` covers
every figure that reaches a `PlotlyChart` here.

## Project association

`Project` is generic app-level grouping owned by the host application, not
this package — `ModelCreateWizard` and `AnnotationWorkspace` accept a
`projectId` prop the host resolves itself rather than implementing project
selection/creation UI here. A host that asks for the project as a step of its own
can pass `firstStep` to `ModelCreateWizard` to continue the numbering.

## Development

```bash
npm install
npm run dev        # demo app with a mock adapter, at src/demo/
npm test           # vitest
npm run build:lib  # library build (ESM + UMD + generated .d.ts)
npm pack --dry-run # confirm dist/ is in the package
```

## Releasing

`.github/workflows/publish.yml` publishes to public npm when a `v*` tag is
pushed. The tag must equal `v` + the `package.json` version. It needs an
`NPM_TOKEN` repository secret (npm automation token). It runs tests, the bundle
size check, the library build, and checks `dist/` is in the packed tarball
before `npm publish --access public`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full release checklist and
[CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## How to cite

If you use vue-legal-ml-builder in research or teaching, please cite it. The
citation metadata is in [`CITATION.cff`](CITATION.cff) (GitHub's "Cite this
repository" button reads it); [`codemeta.json`](codemeta.json) carries the
same metadata in CodeMeta form.

> Chakravarthy, S. (2026). *vue-legal-ml-builder* (Version 0.2.0) [Computer
> software]. Maastricht University. https://github.com/shashankmc/vue-legal-ml-builder

**DOI:** not yet assigned. Once the repository is connected to Zenodo, each
GitHub release will be archived there and its DOI (and a DOI badge) will be
added to this section and to `CITATION.cff`.

The reference backend for these components is
[legal-ml-core](https://github.com/shashankmc/legal-ml-core); cite both if
you use both.

## License

[MIT](LICENSE) © 2026 Shashank Chakravarthy, Maastricht University.
