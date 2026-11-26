import type { App } from 'vue'
import './styles/tokens.css'
import './styles/components.css'
import { createSelfHostedAdapter } from './adapters/selfHosted'
import ActiveLearningPanel from './components/ActiveLearningPanel.vue'
import AnnotationWorkspace from './components/AnnotationWorkspace.vue'
import DatasetEda from './components/DatasetEda.vue'
import LlmAssistPanel from './components/LlmAssistPanel.vue'
import LabelReview from './components/LabelReview.vue'
import DatasetManager from './components/DatasetManager.vue'
import ModelCreateWizard from './components/ModelCreateWizard.vue'
import ModelDetail from './components/ModelDetail.vue'
import ModelList from './components/ModelList.vue'
import ModelParameterForm from './components/ModelParameterForm.vue'
import ModelQuestionTree from './components/ModelQuestionTree.vue'
import ParameterPerformanceExplorer from './components/ParameterPerformanceExplorer.vue'
import ConfusionMatrix from './components/shared/ConfusionMatrix.vue'
import ModelLens from './components/shared/ModelLens.vue'
import PlotlyChart from './components/shared/PlotlyChart.vue'
import ThemeSwitcher from './components/shared/ThemeSwitcher.vue'
import SegmentationEditor from './components/summarization/SegmentationEditor.vue'
import SummarizationWidget from './components/summarization/SummarizationWidget.vue'
import SummaryControls from './components/summarization/SummaryControls.vue'
import SummaryDisplay from './components/summarization/SummaryDisplay.vue'
import SummaryExportPanel from './components/summarization/SummaryExportPanel.vue'
import SummaryInputPanel from './components/summarization/SummaryInputPanel.vue'
import SummaryProgress from './components/summarization/SummaryProgress.vue'
import SummaryResultsPanel from './components/summarization/SummaryResultsPanel.vue'
import SummaryVersionHistory from './components/summarization/SummaryVersionHistory.vue'
import TrainingCurves from './components/TrainingCurves.vue'
import TrainingMonitor from './components/TrainingMonitor.vue'
import { MlBuilderThemeProvider, applyTheme, clearTheme, createTheme, ensurePresetStyles } from './theme'
import type { MlBuilderTheme, ThemeConfig, ThemeOverrides, ThemePreset, ThemeToken } from './theme'
import type { MLAdapter, MLBuilderPluginOptions } from './types'

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function resolveAdapter(opts: MLBuilderPluginOptions): MLAdapter {
  if ('listDatasets' in opts.adapter) return opts.adapter
  return createSelfHostedAdapter(opts.adapter)
}

/** Vue plugin — registers all components globally and provides the adapter.
 * Components also accept an explicit `adapter` prop for non-plugin,
 * directly-imported usage. */
export const VueLegalMlBuilderPlugin = {
  install(app: App, opts: MLBuilderPluginOptions) {
    const adapter = resolveAdapter(opts)
    app.provide('vmlb:adapter', adapter)
    app.provide('vmlb:pollInterval', opts.pollInterval ?? 3000)
    app.provide('vmlb:hideAnnotation', opts.hideAnnotation ?? false)
    app.provide('vmlb:trainingCurves', opts.trainingCurves ?? {})
    if (opts.theme && typeof document !== 'undefined') {
      applyTheme(opts.themeTarget ?? document.documentElement, opts.theme)
    }
    app.component('MlBuilderThemeProvider', MlBuilderThemeProvider)
    app.component('DatasetManager', DatasetManager)
    app.component('DatasetEda', DatasetEda)
    app.component('ModelList', ModelList)
    app.component('ModelCreateWizard', ModelCreateWizard)
    app.component('ModelDetail', ModelDetail)
    app.component('ModelParameterForm', ModelParameterForm)
    app.component('ModelQuestionTree', ModelQuestionTree)
    app.component('TrainingMonitor', TrainingMonitor)
    app.component('TrainingCurves', TrainingCurves)
    app.component('ParameterPerformanceExplorer', ParameterPerformanceExplorer)
    app.component('AnnotationWorkspace', AnnotationWorkspace)
    app.component('ActiveLearningPanel', ActiveLearningPanel)
    app.component('LlmAssistPanel', LlmAssistPanel)
    app.component('ConfusionMatrix', ConfusionMatrix)
    app.component('ModelLens', ModelLens)
    app.component('PlotlyChart', PlotlyChart)
    app.component('ThemeSwitcher', ThemeSwitcher)
    app.component('SegmentationEditor', SegmentationEditor)
    app.component('SummarizationWidget', SummarizationWidget)
    app.component('SummaryControls', SummaryControls)
    app.component('SummaryDisplay', SummaryDisplay)
    app.component('SummaryExportPanel', SummaryExportPanel)
    app.component('SummaryInputPanel', SummaryInputPanel)
    app.component('SummaryProgress', SummaryProgress)
    app.component('SummaryResultsPanel', SummaryResultsPanel)
    app.component('SummaryVersionHistory', SummaryVersionHistory)
  },
}

export default VueLegalMlBuilderPlugin

// ---------------------------------------------------------------------------
// Named exports for direct (non-plugin) usage
// ---------------------------------------------------------------------------

export {
  ActiveLearningPanel,
  AnnotationWorkspace,
  ConfusionMatrix,
  DatasetEda,
  DatasetManager,
  LabelReview,
  LlmAssistPanel,
  MlBuilderThemeProvider,
  ModelCreateWizard,
  ModelDetail,
  ModelLens,
  ModelList,
  ModelParameterForm,
  ModelQuestionTree,
  ParameterPerformanceExplorer,
  PlotlyChart,
  SegmentationEditor,
  SummarizationWidget,
  SummaryControls,
  SummaryDisplay,
  SummaryExportPanel,
  SummaryInputPanel,
  SummaryProgress,
  SummaryResultsPanel,
  SummaryVersionHistory,
  ThemeSwitcher,
  TrainingCurves,
  TrainingMonitor,
}

export { applyTheme, clearTheme, createTheme, ensurePresetStyles, themeTokens } from './theme'
export { PRESET_TOKENS, THEME_IDS, THEME_PRESETS, isThemeId, presetMeta } from './theme'
export type { MlBuilderTheme, ThemeConfig, ThemeOverrides, ThemePreset, ThemeToken } from './theme'
export type { ThemeId, ThemeMode, ThemePresetMeta } from './theme'

export { createSelfHostedAdapter } from './adapters/selfHosted'
export type { SelfHostedAdapterOptions } from './adapters/selfHosted'

export { mountComponent } from './mount'
export type { MountedComponent } from './mount'

export { useActiveLearning } from './composables/useActiveLearning'
export { useAnnotation } from './composables/useAnnotation'
export { useDatasets } from './composables/useDatasets'
export { useEda } from './composables/useEda'
export { useLlmAssist } from './composables/useLlmAssist'
export { useModels } from './composables/useModels'
export { useParameterComparison } from './composables/useParameterComparison'
export { useSummarization } from './composables/useSummarization'
export type { SummarizeOptions, SummaryInput } from './composables/useSummarization'
export { useTraining } from './composables/useTraining'
export { useTrainingCurves } from './composables/useTrainingCurves'
export { TRAINING_METRIC_GROUPS, curveCharts, isLearningCurvePoint, metricGroupOf, metricUnitOf, stageEvents, xKindOf } from './utils/trainingCharts'
export type { CurveChart, CurveChartOptions, CurveSeries, CurveXAxis, StageEvent } from './utils/trainingCharts'

export { allModelInfo, ENTITY_MODEL_TYPES, isEntityModelType, isSummaryModelType, modelsByTaskType, modelTypeLabel, parameterRules, parameterSchemas, quickGuideFor, SUMMARY_MODEL_TYPES, taskTypeLabel } from './components/modelCatalogData'
export { classColor, defaultLabels, lensCopy, lensFamily } from './lens/modelLens'
export type { LensCopy, LensFamily, LensPoint } from './lens/modelLens'
export { adviseFor, decisionTreeFor, IMBALANCE_RATIO, SMALL_DATASET_ROWS } from './lens/modelGuide'
export { ANNOTATION_STATE, annotationControls, annotationState, labelledRows, nothingToAnnotateReason } from './annotation/annotationState'
export type { AnnotationControls, AnnotationScreenState } from './annotation/annotationState'
export { CHECK_SAMPLE, GUIDE_STEPS, READY_WARN_BELOW, SHOW_PER_LABEL, SHOW_TOTAL, SINGLE_LABEL_TASK_TYPES, agreementLine, agreementLow, agreementPassed, aiLabellable, aiLabelsToAccept, currentAgreement, guideStep, isSingleLabelTask, labelsShortOfReady, readySummary, readyToTrain, showTargets, stepsMet, validateLabels } from './annotation/guide'
export type { Disagreement, GuideProgress, GuideStep, GuideStepKey, LabelDraft, LabelErrors, ReadyLabel, ReadySummary, RestScope, ShowLabelTarget, ShowTargets, TryView } from './annotation/guide'
export { DEFAULT_LLM_PROVIDER, LLM_PROVIDERS, llmModelOptions, llmProviderById } from './annotation/llmProviders'
export type { LlmProvider } from './annotation/llmProviders'
export { kitLabelset, labelColour } from './annotation/labelColours'
export { assignmentChanged, labelSourceText } from './annotation/review'
export { STRATEGY_COPY, holdoutClassText, retrainPrompt, trainingWarning, verificationText } from './annotation/activeLearning'
export { buildExport, downloadExport } from './summarization/exportSummaries'
export { SUMMARY_STATUS_LABEL, defaultSummaryModel, formatSummaryDate, isFinalRefusal, sourceBadgeClass, summaryFailureMessage, summaryModelChoices } from './summarization/summaryDisplay'
export type { SummaryModelChoice } from './summarization/summaryDisplay'
export type { DatasetFacts, DecisionTree, GuideAdvice, GuideContext, GuideNode, GuideOption } from './lens/modelGuide'

export type {
  AnnotationAssignment,
  AnnotationTaskPageFilter,
  ActiveLearningRound,
  ActiveLearningSettings,
  ActiveLearningStartOptions,
  ActiveLearningState,
  AnnotationStats,
  AnnotationTask,
  Dataset,
  DatasetUploadMeta,
  DocumentSegment,
  EdaResult,
  ExportFormat,
  ExplanationResult,
  GenerationSource,
  Id,
  LlmAcknowledgement,
  LlmModelOption,
  LlmModelsRequest,
  LlmAgreement,
  LlmErrorCode,
  LlmEstimate,
  LlmJob,
  LlmJobStatus,
  LlmKeyInput,
  LlmMode,
  LlmPrompt,
  LlmRefusalError,
  LlmStatus,
  LlmSuggestion,
  LlmSuggestionBatch,
  LlmSuggestionStatus,
  MLAdapter,
  MLBuilderPluginOptions,
  MlModel,
  ModelCatalog,
  ModelFit,
  ParameterRule,
  ModelComparison,
  ModelParameters,
  ModelStatus,
  ModelTypeInfo,
  MonitoringSettings,
  ParameterComparisonPoint,
  ParameterFieldSchema,
  ParameterFieldType,
  PersistedSummary,
  PredictionResult,
  RefusalError,
  SegmentPatch,
  SummarizationError,
  SummarizationJob,
  SummarizationJobStatus,
  SummarizationModel,
  SummarizationModels,
  SummarizationRequest,
  SummaryDocument,
  SummaryLength,
  SummaryPriority,
  SummaryResult,
  SummaryStoreAdapter,
  SummaryStoreId,
  TrainingCurvesOptions,
  TrainingJob,
  TrainingJobStatus,
  TrainingMetricGroup,
  TrainingMetricPoint,
  TrainingXKind,
} from './types'
