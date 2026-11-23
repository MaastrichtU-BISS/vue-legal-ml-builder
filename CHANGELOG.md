# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, minor releases may contain breaking changes.
Versions 0.1.0 and 0.2.0 were not tagged; their links point at commits
(0.2.0 is the `package.json` bump at `68959e2`). Releases from 0.3.0 on are
tagged `vX.Y.Z`.

## [Unreleased]

## [0.13.0] - 2026-11-23

### Fixed

- A shared key the usage meter cannot vouch for is treated as no usable
  access (#166): when the status says `shared_key_available: false`, the panel
  shows the backend's reason instead of the "Suggestions use the shared key…"
  line, hides everything that would spend the shared key, and opens the
  "Add your own API key" form straight away — saving a key still switches the
  panel to the BYOK line. Older backends that omit the field are unaffected.

## [0.12.0] - 2026-11-18

### Added

- **The wizard offers the NER and summarization models** (#14, BAIGLE #117):
  `legalbert_ner` and `distilbert_ner` for an NER Dataset, and `t5_small` for a
  summarization Dataset. Each has a catalogue entry, a plain-language guide and
  a parameter form whose keys, ranges and defaults match legal-ml-core's.
- Model scores are shown per view. The model list shows accuracy, F1, ROUGE-1
  and ROUGE-L, so classifiers now show F1 beside accuracy. The model page and
  the training monitor show accuracy, precision, recall and F1 for classifiers;
  F1, with precision and recall, for entity models; and ROUGE-1, ROUGE-2 and
  ROUGE-L for summarization models. A score is never a blank or NaN. The
  parameter explorer offers the ROUGE scores too.
- The model page shows an entity model's predictions as each entity with its
  type ("No entities found" when there are none) and its per-entity report,
  and a summarization model's prediction as the written summary; neither shows
  the classifier performance chart.
- `isEntityModelType`, `isSummaryModelType`, `ENTITY_MODEL_TYPES` and
  `SUMMARY_MODEL_TYPES` are exported.

### Fixed

- The wizard no longer lets a model the dataset cannot train be created: a
  model chosen while the fit was loading is replaced once the fit says it
  cannot train it (or leaves it out), as is one the fallback catalogue does
  not offer; Create & train waits for the fit or catalogue, and only the
  latest request counts when the dataset changes, defaults included. A
  model the dataset is not offered can never be chosen (by a click, the guide
  or a late overview) or submitted; the guide falls back from a
  recommendation that is not offered and says so; and a catalogue that names
  the task with no models offers none rather than the built-in list.

## [0.11.0] - 2026-11-17

### Added

- **A type scale a host can theme** (BAIGLE #153): `--vmlb-font-size-2xs`,
  `-xs`, `-sm`, `-md`, `-base`, `-lg`, `-xl`, `-2xl` and `-3xl`, in
  `themeTokens` as `font-size-*`. Every font size in the components now comes
  from the scale, so a host maps it onto its own the way it maps colour,
  radius and spacing.
- `--vmlb-label-case` and `--vmlb-label-tracking` (`label-case`,
  `label-tracking`) for the small labels and eyebrows (`.vmlb-label`, the
  model lens badge, the guide's recommendation label). The defaults keep them
  uppercase; `none` and `0` give sentence case.
- **The demo offers LLM suggestions** (BAIGLE #156): an Annotate view on a
  Dataset of 40 lease clauses, and LLM methods on the demo adapter that run in
  memory, with no network calls. A keyword rule stands in for the model
  (`shall not` → Prohibition, `shall`/`must` → Obligation, `may` → Permission),
  with a one-line reason. It keeps legal-ml-core's rules: consent per Dataset
  before anything is sent, at most 10 items a request, a 200,000-token monthly
  limit on the shared key, and bulk accept at 30 checked items with 80%
  agreement. Labelling many items runs as a short job. Demo code only: the
  published library is unchanged.
- Summarization, folded in from the standalone summarizer package, which is
  retired. `SummarizationWidget` composes `SummaryInputPanel`, `SummaryControls`,
  `SummaryProgress` and `SummaryDisplay`; `SummaryResultsPanel`,
  `SummaryVersionHistory`, `SegmentationEditor` and `SummaryExportPanel` read a
  host-supplied `SummaryStoreAdapter`. All are registered by the plugin, styled
  with the builder's tokens, and shown in the demo's Summarise view.
- Optional `MLAdapter` methods `summarize`, `getSummarizationJob` and
  `getSummarizationModels` for legal-ml-core's `/api/summarize` routes, implemented
  by `createSelfHostedAdapter` and the demo adapter.
- `useSummarization` polls a request until it is `complete` or `error`; a 404 or
  other 4xx ends it at once, a network error or 5xx is retried up to five times
  in a row.
- The model picker is filled from `GET /api/summarize/models`; abstractive models
  are disabled while the server reports none available.
- `buildExport`, `downloadExport` and the summarization types are exported.
- `LlmStatus.shared_key_configured`, optional: whether the platform has a shared
  key at all, for any account.

### Fixed

- **The LLM panel blamed the account when the platform had no shared key.**
  With `mode: 'none'` it said "not available for your account" whether the
  deployment had no shared key or had one this account may not use. When the
  status says `shared_key_configured: false` it now says "This platform has no
  shared LLM key. Add your own API key to use LLM suggestions." Without the
  field (older servers) the wording is unchanged. Needs legal-ml-core 0.14.1 for
  the new wording (reducing_digital_divide #155).

### Changed

- Sizes between steps snap to the scale: 15px titles (model tiles, guide
  questions) become 16px, the 17px confusion-matrix and tile titles and the
  19px wizard step titles become 18px, the 22px training stat becomes 20px,
  and the 13.6px model-fit reason becomes 13px.
- The summarization components use the scale too; the 17px results-tile title
  becomes 18px.
- The annotation kit follows the type scale (BAIGLE #154): `.vmlb-kit` maps
  the kit's `--lak-font-size-2xs` … `-base`, `--lak-label-case` and
  `--lak-label-tracking` onto the builder's tokens, so the kit's panels,
  suggestion cards and badges use the same sizes as the rest of the builder.
  The kit pin moves to `ede6317`, which reads them
  (MaastrichtU-BISS/vue-legal-annotation-kit#13).
- Errors from `createSelfHostedAdapter` carry the response's HTTP `status`.

### Removed, compared with the standalone summarizer

- The adapters that called hosted LLM APIs directly, and the separate summarization adapter type:
  summaries go through the self-hosted backend only.
- Server-sent events: progress is polled only.
- The `theme` prop and `--vsumm-*` tokens: the builder's theme applies.
- The `availableModels` prop: models come from the server.
- PDF and Word uploads, which were read as text: uploads are plain `.txt`.


## [0.10.1] - 2026-11-13

### Fixed

- **Review labels could save one item's labels onto another.** Moving to the
  next item showed it with the previous item's labels until a real server
  answered, and Back or Next then saved them onto it. The item and its labels
  now arrive together. Found in BAIGLE #149 QA.
- Two labels in a set no longer share a colour when their names hash alike
  (Civil and Criminal did): `kitLabelset` gives a later one the next free colour.

## [0.10.0] - 2026-11-13

### Added

- **Review labels** in `AnnotationWorkspace` (BAIGLE #148): the Dataset's labelled
  items in row order, filtered by label, in the kit with Back/Next. It says where
  each label came from (`labelSourceText`) and what the file said for a changed
  file label. Only a real change is saved (`assignmentChanged`), as a person's
  label. Needs the new optional adapter method `pageAnnotationTasks(projectId,
  { status, datasetId, label, includeHoldout, limit, offset })` → `{ tasks, total }`,
  which `createSelfHostedAdapter` implements against legal-ml-core 0.13.
- `AnnotationAssignment` carries `labelSource`, `fileLabel` and `hint`; an NER item
  shows the file's entity types above the text. `AnnotationTask` has `file_label`.

### Changed

- A Dataset whose rows all have labels ends on "Every item has a label" with
  Review labels, not on a dead end; the end state no longer says "You annotated",
  as file labels count. The kit's theme mapping (`.vmlb-kit`) moves to the shared
  stylesheet.

## [0.9.0] - 2026-11-13

### Changed (breaking)

- `AnnotationWorkspace` shows each item in
  [legal-annotation-kit](https://github.com/shashankmc/vue-legal-annotation-kit)'s
  `AnnotatorView` (BAIGLE ADR 0007). Two adapter methods are now **required**:
  `getAnnotationAssignment(taskId)` → `AnnotationAssignment` and
  `saveAnnotationAssignment(taskId, assignment)` → `AnnotationTask`
  (legal-ml-core `GET`/`PUT /api/annotation/tasks/<id>/assignment`). Adapters
  without them, such as Legal Blocks', must add them before upgrading.
- The kit's Save replaces **Save & Next** and the N key; Skip moves into the kit's
  header and keeps the S key. Single-label items take one tag at a time, NER spans
  may not overlap, and relations, confidence and metadata are hidden.
- A Dataset that names no labels gets a **New label** field above the labels;
  a new label is saved with the first item that uses it.
- `legal-annotation-kit` is a dependency (pinned by commit until it releases);
  its stylesheet is bundled into `vue-legal-ml-builder/style.css`, and its colours
  follow the builder theme, light and dark.
- The LLM suggestion for the item on screen is a legal-annotation-kit proposal
  (BAIGLE #140): Accept confirms it, **Change to…** corrects it, Reject rejects it,
  and the agreement check refreshes. The builder's own suggestion card is gone.
- Removed from the exports: `canSaveAnnotation`, `toggleLabel`, `nerSegments`,
  `addEntity` and the `EntitySpan` type, and `save(label)` from `useAnnotation`;
  the kit does that work now.

### Added

- `createSelfHostedAdapter` implements both methods; `AnnotationAssignment`,
  `labelColour(name)` (a label's stable colour) and `kitLabelset(names)` are exported.

### Unchanged

- The queue, progress, holdout, end states, `ActiveLearningPanel` and
  `LlmAssistPanel` (key, acknowledgement, prompt, agreement, bulk accept and jobs).
  A label saved over a waiting suggestion still confirms or corrects it.

## [0.8.0] - 2026-11-13

### Added

- Optional adapter method `getModelFit(datasetId)` → `ModelFit` (legal-ml-core
  0.11: `GET /api/models/available?dataset_id=`). With it, the model step lists
  every model: those that cannot train the chosen Dataset are greyed out, cannot
  be chosen, and say why; the guide and the default choose only among the rest.
  When none fits, a note says so with the server's advice.
- `createSelfHostedAdapter` implements `getModelFit`; `ModelFit` is exported.

## [0.7.0] - 2026-11-06

### Added

- LLM suggestions in `AnnotationWorkspace`, for single-label classification, through a
  new `LlmAssistPanel` (legal-ml-core 0.7.0 `/api/llm`). It appears only when the adapter
  implements `getLlmStatus` and the Dataset names two labels, so Legal Blocks adapters
  are unchanged. The panel:
  - says whether the shared key, the user's own key or none is in use, where text is
    sent, and the shared key's tokens left this month;
  - adds and deletes an own key (base URL, model, key). The key is write-only: it is
    cleared from the form once sent and never shown again;
  - asks each Project to acknowledge the destination the backend names before anything
    is sent, and again when it changes;
  - suggests labels for the current batch. Each suggestion shows on its item with the
    rationale, with Accept and Reject; choosing another label corrects it. None is a
    label until confirmed;
  - shows the agreement check (items checked out of the host's minimum, agreement
    against its threshold) and keeps bulk accept locked until it passes;
  - edits the prompt under "Advanced": label definitions and the template, saved as a
    new version, with the backend's reason when an edit is refused;
  - labels the next items in the queue, or every pending item, as a job on the worker,
    after a cost estimate, and follows its progress;
  - at the monthly limit, says so and offers an own key.
- An LLM-suggested first batch in `ActiveLearningPanel` (legal-ml-core 0.8.0), offered
  when the server's `seed_sources.llm` is true and the adapter implements the new
  `estimateActiveLearningSeed`. Start first shows what the LLM labels, the tokens and
  the destination, and starts only on "Start with the LLM"; over the monthly limit it
  offers an own key instead. If the Project has not allowed the destination, it asks,
  then starts. While the LLM chooses the batch the panel shows its progress, and the
  workspace serves the batch once it is ready; if the LLM fails, the random order
  stays.
- The suggestion batch follows the server's `max_sync_tasks` when the status reports it.
- Optional `MLAdapter` methods for every `/api/llm` route (`getLlmStatus`, `saveLlmKey`,
  `deleteLlmKey`, `acknowledgeLlmDestination`, `getLlmPrompt`, `updateLlmPrompt`,
  `createLlmSuggestions`, `listLlmSuggestions`, `confirmLlmSuggestion`,
  `rejectLlmSuggestion`, `getLlmAgreement`, `bulkAcceptLlmSuggestions`,
  `estimateLlmAnnotation`, `startLlmAnnotation`, `getLlmJob`), implemented by
  `createSelfHostedAdapter`. Its refusals keep the backend's `code` and `destination`
  (`LlmRefusalError`). The `Llm*` types, `LlmAssistPanel` and `useLlmAssist` are exported.
- `useAnnotation` has `confirmSuggestion`, which accepts or corrects a suggestion for the
  item on screen and moves on.

## [0.6.0] - 2026-11-05

### Added

- `TrainingCurves` draws a classical run's learning curve (legal-ml-core
  `monitoring.learning_curve`) on a chart of its own, "Learning curve", against the
  number of training examples. Its `learning_curve_*` points are left out of the
  Training and Evaluation charts, and stay apart when `groupBy` is `'none'`. A slot's
  `charts` has it with `group: 'learning_curve'`, and `isLearningCurvePoint` is exported.
  `ModelTypeInfo.supports_learning_curve` says whether a model type can record one.

- `MonitoringSettings` and `ModelParameters` are exported: a run's own monitoring goes
  under `parameters.monitoring` (`log_every_n_steps`, `eval_strategy` with `eval_steps`,
  `include` / `exclude` name globs, `flush_every_points` / `flush_every_seconds` for how
  often metric points are written, and `learning_curve` / `system_metrics`). `MlModel.parameters`, `createModel` and `updateModel` use
  `ModelParameters`. A refusal of one of these names `monitoring.<setting>` as its field.
- `npm test` also type-checks the type-level tests (`tests/*.test-d.ts`), through
  `npm run test:types`.
- The training curves can be configured. `TrainingCurves` takes `metrics` (which metrics to
  draw), `groupBy` (`'group'`, or `'none'` for one chart), `xAxis` (`'step'` or `'epoch'`),
  `pollIntervalMs`, `smoothing` (a moving-average weight from 0) and `logScale`, and
  `TrainingMonitor` passes them through. Unset, the curves look and poll as before.
- App-wide defaults for those settings, through the plugin's `trainingCurves` option or
  `provide('vmlb:trainingCurves', …)`. A prop overrides its default. `TrainingCurvesOptions` is
  exported.
- The resource readings a run takes with `monitoring.system_metrics` on are drawn one
  chart per unit, each titled with it: Memory (MB), GPU use (%), Speed (samples/s)
  and Time remaining (s). Its value axis names the unit. `CurveChart` has the
  `unit`. It is the point's `unit` from legal-ml-core; a point without one gets it
  from the end of its name through `metricUnitOf(name)`.
  A host matching the single System chart's title must update.
- A default slot on `TrainingCurves` lets a host draw the curves its own way. It gets the
  configured `charts`, the `stages` and the raw `points`. `curveCharts` takes the same
  settings as a second argument (`CurveChartOptions`), and a chart with grouping off has the
  group `all`.
- `TrainingMetricPoint` has `group` (`TrainingMetricGroup`: `train`, `eval`, `system` or
  `stage`) and, for fine-tuning, `training_step`, the trainer's own step. `step` stays the
  polling cursor. A point without a group gets one from its name, as legal-ml-core does.
  It also has `x_kind` (`TrainingXKind`: `step`, `iteration` or `training_examples`), what
  its `training_step` counts, and `unit`, a system point's unit. A chart's x-axis title
  follows `x_kind`, so logistic regression's loss by iteration is drawn against
  Iteration, not Training step. A point without `x_kind` gets it from its name through
  `xKindOf`, which is exported.
  `TRAINING_METRIC_GROUPS`, `metricGroupOf`, `curveCharts` and `stageEvents` are exported
  for hosts that draw their own curves.
- `TrainingMonitor` has a Stop training button while a run is in progress. It asks inline
  before stopping, so hosts need no dialog of their own. A stopped run then reads Training
  stopped, with Train again, instead of Training failed, and the component emits `stopped`.
  When the run ends before the stop arrives, it says so.
- `useTraining().stop()` resolves to `'stopped'`, `'finished'` (the run ended first) or
  `'error'` (still running; `error` says why and polling continues), and `isStopping` is
  true while it is in flight.
- `ModelParameterForm`, the settings form from `ModelCreateWizard`, can be used on its own,
  for example to change a trained Model's settings. Give it `modelType`, the starting
  `parameters` (missing ones take their defaults), and optionally `modelInfo`, `rowCount`,
  `labels`, `refusedField` and `refusalId`. It reports the settings to send in a `change`
  event. The wizard looks and behaves as before.
- `MLAdapter.updateModel(id, { name?, parameters? })`, optional, renames a Model or replaces
  its settings. `createSelfHostedAdapter` sends it as `PUT /models/<id>`, and a refusal keeps
  its `field` as with `createModel`.
- The guide settles settings as well as the Model, and says why in one or two plain sentences. A `GuideOption` can
  carry `settings: { parameters, why }`. Its answers on rules a colleague can follow, getting the most results right,
  and setting unusual documents aside now come with a shorter tree, more trees and comparing documents by their words.
- The guide fits its advice to the Dataset. When the most common label is at least three times the rarest, it weights
  rare labels up wherever the Model can. Below 1,000 documents it recommends a Model other than LegalBERT or RoBERTa.
  `adviseFor(option, facts?, context?)` gives this advice to a host. Its settings go through the same schema and rules
  as the settings form, using the backend's catalogue when given, so the backend does not refuse them.
- `ModelQuestionTree` takes optional `rowCount`, `labelCounts`, `catalogue` and `availableModels`, and
  `ModelCreateWizard` passes them. The wizard now reads the Dataset's overview even when the Dataset declares its labels.

### Changed

- `TrainingCurves` draws one chart per group (Training, Evaluation, System), each against
  the training step, falling back to the epoch. Stage markers are listed as labelled events
  instead of lines at 1.0. The single `#vmlb-training-curves` chart is now one
  `.vmlb-curves-chart` per group, with plot ids `vmlb-training-curves-<group>`.
- The demo adapter's training run has a loss curve and two evaluations as well as its stages.
- `ModelCreateWizard` opens the model step on the guide questions instead of folding them away. "Choose a model myself"
  swaps them for the full grid, and "Help me choose instead" brings them back. The default model is still chosen, so
  skipping the questions changes nothing. The `details.vmlb-chooser` disclosure and its "Help me choose a model"
  summary are gone, and `.vmlb-show-models` now reads "Choose a model myself".
- The guide's questions and answers are in plain words, and its recommendation gives the reason for the answer
  instead of the model's technical description. Hosts or tests that match the old wording must update it.
- `ModelQuestionTree`'s `select` event is `select(modelType, parameters)`, and now sends the recommended settings
  with the Model. With `autoApply` it sends them again if the Dataset's facts arrive later and change the advice.

### Removed

- Named entity recognition and text summarisation offer no models, and `decisionTreeFor` and `quickGuideFor`
  return `null` for them, because the backend cannot train them yet. The wizard says so instead of offering
  LegalBERT and RoBERTa. It reads "A Model cannot be trained for … yet. Choose a Dataset with another task type."

### Fixed

- A component mounted with `mountComponent` now follows the props passed later through
  `updateProps`. Before, it kept the props it was mounted with.
- Without the backend's catalogue, the settings form and the guide keep to legal-ml-core's limits: Maximum Tree
  Depth stops at 50, Regularisation (C) at 100, and Number of Clusters at the Dataset's rows, with the other
  numbers' maxima to match. Before, they could offer values the backend refuses. `ParameterFieldSchema` gains
  `atMostRows`.

## [0.5.5] - 2026-10-31

### Added

- A refusal that names a setting offers a "Go to" button, so that setting can be reached on a phone.

## [0.5.4] - 2026-10-31

### Added

- `createSelfHostedAdapter` keeps a refusal's `field` on the Error it throws, typed as
  `RefusalError`. Adapters that send none work as before.
- When a refusal names a setting, `ModelCreateWizard` marks it with `aria-invalid` and
  `aria-describedby` pointing at the alert, and opens Advanced settings. The mark clears
  on any change. The alert stays beside the buttons, and the buttons stay in view.

## [0.5.3] - 2026-10-31

### Fixed

- A refusal keeps Create & train in view when the alert pushes the buttons past the viewport.

## [0.5.2] - 2026-10-31

### Fixed

- `ModelCreateWizard` shows a refusal beside Create & train, as an alert, instead of out
  of view at the top of the form, and clears it when a value changes.

## [0.5.1] - 2026-10-31

### Changed

- `ModelCreateWizard` takes options, ranges and defaults from the backend catalogue,
  and adds only the explanations, so the two cannot drift. `parameterSchemas` remains
  the fallback for a host without one, and is aligned with legal-ml-core.
- The wizard applies the catalogue's new `rules`: a penalty narrows the solvers, ward
  linkage narrows the distances and `liblinear` goes on a Dataset of more than two
  labels. A choice ruled out moves to one still open, and a note says why.
- New settings in the wizard: balancing labels, and the elasticnet mix, shown only
  with that penalty. NMF's L1 ratio is gone. Clearing a number uses its default.
- A cluster count is capped at the Dataset's rows, given `at_most_rows` from the
  backend. New exports: `parameterRules` and the `ParameterRule` type.
- UK spelling in parameter help, such as "penalises" and "Initialisation".

## [0.5.0] - 2026-10-30

### Changed

- `ModelCreateWizard` is shorter: the chooser questions start closed under "Help
  me choose a model", and only the chosen model shows until "Show all N models".
- Task types read in words in the wizard and `DatasetManager`, and `taskTypeLabel`
  says "text classification". User-facing copy follows UK spelling, such as "Topic
  Modelling" and "Analyse".

## [0.4.0] - 2026-10-30

### Added

- `AnnotationWorkspace` reaches parity with BAIGLE's annotation screen: choose a
  label then Save & Next, multi-label, NER span tagging, guidelines, S and N keys,
  skipped-item review, and honest end states. New props: `taskType`, `projectName`,
  `guidelines`, `rowCount`, `unlabelledRows`, `backHref`, `createModelHref`.
- `ActiveLearningPanel`: start a loop, the retrain prompt, held-back items and
  "Not independently verified". Strategies are named in plain language under
  Advanced. The LLM seed is shown disabled until LLM assistance lands.
- The panel warns by name when training opens with labels short of their minimum,
  through `trainingWarning`, and counts held-back items by label through
  `holdoutClassText`.
- A label typed wrong can be corrected from the panel, through the optional
  `correctActiveLearningLabel` adapter method.
- Optional adapter methods for active learning and `listAnnotationTasks`. Without
  them the workspace is plain annotation.
- `annotationState`, `labelledRows`, `retrainPrompt` and related helpers exported.

### Changed

- Clicking a label selects it. Saving takes Save & Next, so it no longer saves on
  click.
- Needs `legal-ml-core` with `/api/active-learning` for the loop.

## [0.3.1] - 2026-10-30

### Added

- Wizard preselects a model (Logistic Regression for classification, otherwise
  the catalogue default) and tucks settings under a closed Advanced section.
- `firstStep` prop so a host can continue its own step numbering.

### Changed

- Label names load for any selected dataset, not only a preselected one.

### Fixed

- A preselected dataset now loads the backend catalogue.
- Removed the left stripe from the model chooser tile.

## [0.3.0] - 2026-10-29

### Added

- `hideAnnotation` option (prop on `AnnotationWorkspace` and plugin option,
  default `false`): hidden views render nothing and call no annotation
  operation (#33).
- Publish workflow: on a `v*` tag, checks that the tag equals the
  `package.json` version, runs tests, the bundle-size check and the library
  build, verifies the files named by `main`, `module`, `types` and the style
  export are in the packed tarball, and publishes to the public npm registry
  (#33).
- Two-tier design token system, theme preset registry and theming API,
  `ThemeSwitcher` component, shared component primitives stylesheet, and an
  inline SVG icon component.
- Model wizard: auto-applies the recommendation, uses the backend task-type
  catalogue, and creates and trains in one action.
- FAIR4RS metadata: `LICENSE` (MIT), `CITATION.cff`, `codemeta.json` and
  `.zenodo.json`, plus a "How to cite" section in the README.
- `CHANGELOG.md` and `CONTRIBUTING.md`.

### Changed

- Redesigned `DatasetManager`, `ModelList`, `ModelCreateWizard`,
  `ModelQuestionTree`, model detail, training monitor, curves and explorer,
  `DatasetEda` and `AnnotationWorkspace`, and the demo shell (theme picker).
- README documents theming, the `plotly.js-basic-dist` host requirement,
  hiding annotation and releasing.
- `package.json`: homepage, repository and bugs point at
  `shashankmc/vue-legal-ml-builder`; adds author and keywords; the package
  now ships `LICENSE`, `CHANGELOG.md` and `CITATION.cff`.

### Fixed

- Mount through the library's own Vue runtime.

## [0.2.0] - 2026-09-22

### Added

- `ModelLens` and `ModelQuestionTree` components with lens design tokens and
  model lens/guide data, wired into `ModelCreateWizard` and exported.
- Shared self-scheduling, visibility-aware poll loop, adopted by
  `useTraining`, `useTrainingCurves` and `useModels`.
- Bundle-size gate (`npm run check:size`) for the Plotly dependency.
- CI workflow on push and pull request; `package-lock.json` is tracked so CI
  can use `npm ci`.
- Tests for the lens components, `PlotlyChart` lifecycle, `useTrainingCurves`
  and `useModels` polling.

### Changed

- Replaced `plotly.js-dist` with `plotly.js-basic-dist`.
- `PlotlyChart` diffs updates with `Plotly.react` and caches parsed plot data;
  `useTrainingCurves` appends points in place and groups metrics
  incrementally.

### Removed

- Unused `lucide-vue-next` dependency.

### Fixed

- `TrainingCurves` shows an error state instead of throwing when no adapter is
  available.

## [0.1.0] - 2026-08-28

### Added

- Initial Vue 3 component library for the legal-ML workbench (datasets, model
  configuration, training, prediction, visualization, annotation, experiment
  monitoring), extracted from the `reducing_digital_divide` SvelteKit frontend
  and driven through a host-supplied `MLAdapter`.

[Unreleased]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/shashankmc/vue-legal-ml-builder/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/68959e2...v0.3.0
[0.2.0]: https://github.com/shashankmc/vue-legal-ml-builder/compare/c9c724b...68959e2
[0.1.0]: https://github.com/shashankmc/vue-legal-ml-builder/commits/c9c724b
