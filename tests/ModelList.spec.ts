import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ModelList from '../src/components/ModelList.vue'
import { createTestAdapter } from './testAdapter'
import type { MlModel } from '../src/types'

function model(overrides: Partial<MlModel> = {}): MlModel {
  return {
    id: 'm1', user_id: 'u1', dataset_id: 'd1', name: 'A model', model_type: 'svm',
    parameters: {}, status: 'completed', created_at: '', updated_at: '', ...overrides,
  }
}

async function mountList(model: MlModel) {
  const adapter = createTestAdapter({ listModels: vi.fn().mockResolvedValue([model]) })
  const wrapper = mount(ModelList, { props: { adapter } })
  await flushPromises()
  return wrapper
}

describe('ModelList: model scores', () => {
  it('shows accuracy and F1 for a classifier', async () => {
    const wrapper = await mountList(model({
      model_type: 'logistic_regression',
      metrics: { accuracy: 0.91, f1_score: 0.88, precision: 0.9, recall: 0.86 },
    }))

    expect(wrapper.text()).toContain('Accuracy')
    expect(wrapper.text()).toContain('91.0%')
    expect(wrapper.text()).toContain('F1')
    expect(wrapper.text()).toContain('88.0%')
    expect(wrapper.text()).not.toContain('Precision')
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('shows F1 for a completed entity model', async () => {
    const wrapper = await mountList(model({
      model_type: 'legalbert_ner',
      metrics: { f1_score: 0.87, precision: 0.9, recall: 0.84 },
    }))

    expect(wrapper.text()).toContain('LegalBERT (entities)')
    expect(wrapper.text()).toContain('F1')
    expect(wrapper.text()).toContain('87.0%')
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('shows ROUGE-1 and ROUGE-L for a summarization model', async () => {
    const wrapper = await mountList(model({
      model_type: 't5_small',
      metrics: { rouge1: 0.42, rouge2: 0.2, rougeL: 0.39 },
    }))

    expect(wrapper.text()).toContain('T5 small (summaries)')
    expect(wrapper.text()).toContain('ROUGE-1')
    expect(wrapper.text()).toContain('42.0%')
    expect(wrapper.text()).toContain('ROUGE-L')
    expect(wrapper.text()).toContain('39.0%')
    expect(wrapper.text()).not.toContain('NaN')
  })
})
