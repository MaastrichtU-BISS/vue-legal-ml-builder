import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ParameterPerformanceExplorer from '../src/components/ParameterPerformanceExplorer.vue'
import { createTestAdapter } from './testAdapter'

describe('ParameterPerformanceExplorer', () => {
  it('prompts for more runs when fewer than 2 points exist', async () => {
    const adapter = createTestAdapter({ getParameterComparison: vi.fn().mockResolvedValue([]) })
    const wrapper = mount(ParameterPerformanceExplorer, { props: { adapter, modelType: 'svm' } })
    await flushPromises()

    expect(wrapper.text()).toContain('Train at least 2 Support Vector Machine models')
    expect(adapter.getParameterComparison).toHaveBeenCalledWith('svm', 'accuracy')
  })

  it('opens on f1_score for an entity model', async () => {
    const adapter = createTestAdapter({ getParameterComparison: vi.fn().mockResolvedValue([]) })
    mount(ParameterPerformanceExplorer, { props: { adapter, modelType: 'legalbert_ner' } })
    await flushPromises()

    expect(adapter.getParameterComparison).toHaveBeenCalledWith('legalbert_ner', 'f1_score')
  })

  it('opens on rouge1 for the summarization model', async () => {
    const adapter = createTestAdapter({ getParameterComparison: vi.fn().mockResolvedValue([]) })
    mount(ParameterPerformanceExplorer, { props: { adapter, modelType: 't5_small' } })
    await flushPromises()

    expect(adapter.getParameterComparison).toHaveBeenCalledWith('t5_small', 'rouge1')
  })

  it('follows a modelType change, with the metric and the selected parameter', async () => {
    const adapter = createTestAdapter({ getParameterComparison: vi.fn().mockResolvedValue([]) })
    const wrapper = mount(ParameterPerformanceExplorer, { props: { adapter, modelType: 'svm' } })
    await flushPromises()
    expect(adapter.getParameterComparison).toHaveBeenCalledWith('svm', 'accuracy')
    expect((wrapper.findAll('select')[0].element as HTMLSelectElement).value).toBe('C')

    await wrapper.setProps({ modelType: 't5_small' })
    await flushPromises()

    expect(adapter.getParameterComparison).toHaveBeenLastCalledWith('t5_small', 'rouge1')
    expect((wrapper.findAll('select')[0].element as HTMLSelectElement).value).toBe('model_name')
  })

  it('reloads when the metric selector changes', async () => {
    const adapter = createTestAdapter({
      getParameterComparison: vi.fn().mockResolvedValue([
        { model_id: 'm1', training_job_id: 'j1', parameters: { C: 1 }, metric_value: 0.8 },
        { model_id: 'm2', training_job_id: 'j2', parameters: { C: 10 }, metric_value: 0.9 },
      ]),
    })
    const wrapper = mount(ParameterPerformanceExplorer, { props: { adapter, modelType: 'svm' } })
    await flushPromises()

    const metricSelect = wrapper.findAll('select')[1]
    await metricSelect.setValue('f1_score')
    await flushPromises()

    expect(adapter.getParameterComparison).toHaveBeenLastCalledWith('svm', 'f1_score')
  })

  it('shows the parameter explanation copy once enough data is loaded', async () => {
    const adapter = createTestAdapter({
      getParameterComparison: vi.fn().mockResolvedValue([
        { model_id: 'm1', training_job_id: 'j1', parameters: { C: 1 }, metric_value: 0.8 },
        { model_id: 'm2', training_job_id: 'j2', parameters: { C: 10 }, metric_value: 0.9 },
      ]),
    })
    const wrapper = mount(ParameterPerformanceExplorer, { props: { adapter, modelType: 'svm' } })
    await flushPromises()

    expect(wrapper.text()).toContain('A higher C tries to classify')
  })
})
