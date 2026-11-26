import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import GuideTryStep from '../src/components/GuideTryStep.vue'
import { llmAgreement, llmSuggestion } from './fixtures/llm'

// Try it's card on its own: where focus goes after an answer.

afterEach(() => {
  document.body.innerHTML = ''
})

function card() {
  const outside = document.createElement('input')
  document.body.appendChild(outside)
  const wrapper = mount(GuideTryStep, {
    props: { labels: ['Civil', 'Criminal'], view: 'ready', suggestion: llmSuggestion(), agreement: llmAgreement(), busy: false },
    attachTo: document.body,
  })
  return { wrapper, outside }
}

const suggestionCard = '[aria-label="The AI\'s suggestion"]'

describe('Try it: focus after an answer', () => {
  it('moves to the next suggestion when focus stayed with the card', async () => {
    const { wrapper } = card()
    await wrapper.findAll('button').find((b) => b.text() === 'Accept Criminal')!.trigger('click')

    await wrapper.setProps({ suggestion: llmSuggestion({ id: 's2', task_id: 't2' }) })
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.find(suggestionCard).element)
    wrapper.unmount()
  })

  it('leaves focus alone when the student moved it to a field meanwhile', async () => {
    const { wrapper, outside } = card()
    await wrapper.findAll('button').find((b) => b.text() === 'Accept Criminal')!.trigger('click')
    outside.focus()

    await wrapper.setProps({ suggestion: llmSuggestion({ id: 's2', task_id: 't2' }) })
    await flushPromises()

    expect(document.activeElement).toBe(outside)
    wrapper.unmount()
  })

  it('moves to the next suggestion after S on the card, as after the Skip button, without reaching the page\'s own S', async () => {
    const { wrapper } = card()
    let reachedWindow = 0
    const onWindow = (e: KeyboardEvent) => { if (e.key === 's') reachedWindow++ }
    window.addEventListener('keydown', onWindow)
    const el = wrapper.find(suggestionCard)
    ;(el.element as HTMLElement).focus()
    await el.trigger('keydown', { key: 's' })
    expect(wrapper.emitted('skip')).toHaveLength(1)
    expect(reachedWindow).toBe(0)

    await wrapper.setProps({ view: 'asking', suggestion: null })
    await wrapper.setProps({ view: 'ready', suggestion: llmSuggestion({ id: 's2', task_id: 't2' }) })
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.find(suggestionCard).element)
    window.removeEventListener('keydown', onWindow)
    wrapper.unmount()
  })
})

describe('Try it: the held space', () => {
  it('holds every label in the "Pick your label" row, under the card too', () => {
    const wrapper = mount(GuideTryStep, {
      props: {
        labels: ['Yes', 'No', 'Partially upheld with costs reserved'],
        view: 'ready',
        suggestion: llmSuggestion({ label: 'Yes' }),
        agreement: llmAgreement(),
        busy: false,
      },
    })
    const held = wrapper.find('.vmlb-guide-placeholder')
    expect(held.exists()).toBe(true)
    const row = held.find('.vmlb-guide-try-others').text()
    for (const label of ['Yes', 'No', 'Partially upheld with costs reserved']) expect(row).toContain(label)
    wrapper.unmount()
  })

  it('shows no empty box when there is no item to ask about', () => {
    const wrapper = mount(GuideTryStep, {
      props: { labels: ['Civil', 'Criminal'], view: 'idle', suggestion: null, agreement: llmAgreement(), busy: false },
    })
    expect(wrapper.find('.vmlb-guide-suggestion').exists()).toBe(false)
    expect(wrapper.find('.vmlb-guide-count').exists()).toBe(true)
    wrapper.unmount()
  })
})
