import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ModelDetail from '../src/components/ModelDetail.vue'
import { createTestAdapter } from './testAdapter'
import type { MlModel, PredictionResult } from '../src/types'

const PlotlyChart = { name: 'PlotlyChart', props: ['plotData', 'plotId'], template: '<div class="plot-stub" />' }

function model(overrides: Partial<MlModel> = {}): MlModel {
  return {
    id: 'm1', user_id: 'u1', dataset_id: 'd1', name: 'A model', model_type: 'svm',
    parameters: {}, status: 'completed', created_at: '', updated_at: '', ...overrides,
  }
}

async function mountDetail(loaded: MlModel, predict = vi.fn()) {
  const adapter = createTestAdapter({
    getModel: vi.fn().mockResolvedValue(loaded),
    predict,
  })
  const wrapper = mount(ModelDetail, {
    props: { adapter, modelId: 'm1' },
    global: { stubs: { PlotlyChart } },
  })
  await flushPromises()
  return { wrapper, adapter }
}

async function predict(wrapper: ReturnType<typeof mount>, text: string) {
  await wrapper.find('textarea').setValue(text)
  await wrapper.find('.vmlb-card button.vmlb-btn-primary').trigger('click')
  await flushPromises()
}

describe('ModelDetail: entity models', () => {
  it('shows F1 and the per-type report, without the legacy performance chart', async () => {
    const report = '              precision    recall  f1-score   support\n\n         PER       0.90      0.84      0.87        10'
    const { wrapper, adapter } = await mountDetail(model({
      model_type: 'legalbert_ner',
      metrics: { f1_score: 0.87, precision: 0.9, recall: 0.84, classification_report: report },
    }))

    expect(wrapper.text()).toContain('F1')
    expect(wrapper.text()).toContain('87.00%')
    expect(wrapper.find('.vmlb-report').text()).toContain('PER')
    expect(adapter.getModelPerformance).not.toHaveBeenCalled()
    expect(wrapper.findComponent(PlotlyChart).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('renders each entity with its type label', async () => {
    const entities: PredictionResult = {
      text: 'Ann works at Acme',
      prediction: 'PER, ORG',
      entities: [
        { start: 0, end: 3, type: 'PER', text: 'Ann', score: 0.99 },
        { start: 13, end: 17, type: 'ORG', text: 'Acme', score: 0.95 },
      ],
    }
    const { wrapper } = await mountDetail(
      model({ model_type: 'distilbert_ner', metrics: { f1_score: 0.87 } }),
      vi.fn().mockResolvedValue([entities]),
    )

    expect(wrapper.find('textarea').attributes('placeholder')).toBe('Paste text to find entities in…')
    await predict(wrapper, 'Ann works at Acme')

    const chips = wrapper.findAll('.vmlb-entity-chip')
    expect(chips.map((chip) => chip.find('.vmlb-entity-text').text())).toEqual(['Ann', 'Acme'])
    expect(chips.map((chip) => chip.find('.vmlb-entity-type').text())).toEqual(['PER', 'ORG'])
  })

  it('says no entities were found when the list is empty', async () => {
    const { wrapper } = await mountDetail(
      model({ model_type: 'legalbert_ner', metrics: { f1_score: 0.87 } }),
      vi.fn().mockResolvedValue([{ text: 'A plain clause', prediction: '', entities: [] }]),
    )

    await predict(wrapper, 'A plain clause')

    expect(wrapper.text()).toContain('No entities found')
    expect(wrapper.find('.vmlb-entity-chip').exists()).toBe(false)
  })
})

describe('ModelDetail: summarization models', () => {
  it('shows ROUGE and renders the summary as a paragraph', async () => {
    const { wrapper, adapter } = await mountDetail(
      model({ model_type: 't5_small', metrics: { rouge1: 0.42, rouge2: 0.2, rougeL: 0.39 } }),
      vi.fn().mockResolvedValue([{ text: 'A long judgment', prediction: 'The court dismissed the appeal.' }]),
    )

    expect(wrapper.text()).toContain('ROUGE-1')
    expect(wrapper.text()).toContain('42.00%')
    expect(wrapper.text()).toContain('ROUGE-2')
    expect(wrapper.text()).toContain('20.00%')
    expect(wrapper.text()).toContain('ROUGE-L')
    expect(wrapper.text()).toContain('39.00%')
    expect(wrapper.text()).not.toContain('NaN')
    expect(adapter.getModelPerformance).not.toHaveBeenCalled()
    expect(wrapper.findComponent(PlotlyChart).exists()).toBe(false)

    expect(wrapper.find('textarea').attributes('placeholder')).toBe('Paste a document to summarise…')
    await predict(wrapper, 'A long judgment')

    expect(wrapper.find('.vmlb-summary').text()).toBe('The court dismissed the appeal.')
  })
})

describe('ModelDetail: classifiers', () => {
  it('still fetches and draws the performance chart, and keeps the report with the confusion matrix', async () => {
    const report = '              precision    recall  f1-score   support\n\n         yes       0.90      0.84      0.87        10'
    const adapter = createTestAdapter({
      getModel: vi.fn().mockResolvedValue(model({
        model_type: 'svm',
        metrics: {
          accuracy: 0.9, f1_score: 0.88, classification_report: report,
          confusion_matrix: [[5, 1], [0, 4]], confusion_matrix_labels: ['no', 'yes'],
        },
      })),
      getModelPerformance: vi.fn().mockResolvedValue({ performance_chart: { data: [], layout: {} } }),
    })
    const wrapper = mount(ModelDetail, {
      props: { adapter, modelId: 'm1' },
      global: { stubs: { PlotlyChart } },
    })
    await flushPromises()

    expect(adapter.getModelPerformance).toHaveBeenCalledWith('m1')
    expect(wrapper.findComponent(PlotlyChart).exists()).toBe(true)
    expect(wrapper.text()).toContain('Accuracy')
    // The report names the matrix's labels; it is not repeated as its own card.
    expect(wrapper.text()).not.toContain('Classification report')
  })
})
